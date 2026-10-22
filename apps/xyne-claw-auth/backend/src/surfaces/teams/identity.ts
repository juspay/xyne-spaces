/**
 * Teams sender → Xyne user, from what Microsoft asserts about them.
 *
 * The activity the Bot Connector signed carries the sender's tenant and Entra
 * object id, and nothing trustworthy beyond that: the display name is just a
 * label. So the first time an unlinked sender writes, the bot asks Microsoft
 * Graph who that object id is (`GET /users/{oid}`, an app-only token issued by
 * the sender's own tenant) and matches the answer's userPrincipalName against
 * the users of the org that tenant is bound to. Same model as Slack, which
 * links by the email Slack verified, and nothing the person types is ever
 * used.
 *
 * Why the UPN and not `mail`: a UPN's domain has to be one the tenant proved
 * it owns, and a domain can be proved by one tenant only, so a tenant cannot
 * hand its people somebody else's address. `mail` is a free-form attribute an
 * admin can set to anything. Guests (userType Guest, "#EXT#" UPNs) belong to
 * another tenant and are refused; so are disabled accounts.
 *
 * What it needs from each tenant: the app's application permission
 * User.Read.All, admin-consented in that tenant. Without consent the token
 * request fails, the sender stays unlinked, and the bot's reply tells them
 * what is missing.
 */
import { fetch as undiciFetch } from "undici";
import { prisma } from "../../db.js";
import { writeAuditLog } from "../../lib/audit.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import { redisService } from "../../redis.js";
import { REDIS_PREFIX } from "../messaging/const.js";
import type { AuthStateStore, ChannelAccount } from "../messaging/plugin.js";
import { linkSenderToUser } from "../messaging/store.js";
import { botFrameworkAuth, type HttpFetch } from "./auth.js";
import { GRAPH_ORIGIN, SECRET_APP_ID, SECRET_APP_PASSWORD } from "./schema.js";
import { orgForTenant } from "./tenants.js";

const log = createLogger("teams-identity");

/** One directory lookup per sender per minute at most: an unlinked person who
 *  keeps writing must not turn every message into a Graph call. */
const LOOKUP_THROTTLE_S = 60;

const defaultFetch: HttpFetch = (url, init) => undiciFetch(url, init);

/** The fields of a Graph user this module reads. */
export interface EntraUser {
  id?: string;
  userPrincipalName?: string;
  userType?: string | null;
  accountEnabled?: boolean | null;
}

/** The address Microsoft vouches for, or null when this directory entry
 *  must not be matched to anyone (a guest, a disabled account, no UPN). */
export function assertedEmailOf(user: EntraUser): string | null {
  const upn = user.userPrincipalName?.trim().toLowerCase() ?? "";
  if (!upn || upn.includes("#ext#")) return null;
  if (user.userType && user.userType.toLowerCase() === "guest") return null;
  if (user.accountEnabled === false) return null;
  const at = upn.indexOf("@");
  if (at <= 0 || at !== upn.lastIndexOf("@") || at === upn.length - 1) return null;
  return upn;
}

/** The directory entry for one object id, or null when Graph has none. */
export async function readEntraUser(http: HttpFetch, token: string, objectId: string): Promise<EntraUser | null> {
  const url = `${GRAPH_ORIGIN}/v1.0/users/${encodeURIComponent(objectId)}?$select=id,userPrincipalName,userType,accountEnabled`;
  const response = await http(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    // 403 here means the tenant has not granted User.Read.All to the app.
    throw new Error(`Graph user lookup failed: ${payload?.error?.code ?? `HTTP ${response.status}`}`);
  }
  return (await response.json()) as EntraUser;
}

/** True when this sender may be looked up now. Redis down ⇒ look up. */
async function shouldLookUp(orgId: string, senderId: string): Promise<boolean> {
  try {
    const set = await redisService
      .getConnection()
      .set(`${REDIS_PREFIX}:teams-entra-lookup:${orgId}:${senderId}`, "1", "EX", LOOKUP_THROTTLE_S, "NX");
    return set === "OK";
  } catch {
    return true;
  }
}

export interface LinkTeamsSenderInput {
  account: Pick<ChannelAccount, "id" | "orgId" | "surfaceId">;
  authState: AuthStateStore;
  /** Both from the signed activity, lower-case. */
  tenantId: string;
  aadObjectId: string;
  /** "<tenantId>:<aadObjectId>" — what the identity row is keyed by. */
  senderId: string;
}

/**
 * Link an unlinked Teams sender to the org user Microsoft says they are.
 * Returns that user's id, or null when there is no such user (or the lookup
 * could not be made); the caller then sends the link prompt.
 */
export async function linkTeamsSender(
  input: LinkTeamsSenderInput,
  deps: { http?: HttpFetch; auth?: Pick<typeof botFrameworkAuth, "graphToken"> } = {},
): Promise<string | null> {
  const { account, tenantId, aadObjectId, senderId } = input;
  if (senderId !== `${tenantId}:${aadObjectId}`) return null;
  // Checked on the way in already (plugin.ts); checked again because this is
  // the step that writes a link, and a binding can be removed in between.
  if ((await orgForTenant(tenantId)) !== account.orgId) return null;
  if (!(await shouldLookUp(account.orgId, senderId))) return null;

  const appId = await input.authState.get(SECRET_APP_ID, "");
  const appPassword = await input.authState.get(SECRET_APP_PASSWORD, "");
  if (!appId || !appPassword) return null;

  let entraUser: EntraUser | null;
  try {
    const token = await (deps.auth ?? botFrameworkAuth).graphToken({ appId, appPassword, tenantId });
    entraUser = await readEntraUser(deps.http ?? defaultFetch, token, aadObjectId);
  } catch (err) {
    // Usually: this tenant's admin has not consented to User.Read.All yet.
    log.warn(`[teams-identity] directory lookup failed account=${account.id} tenant=${tenantId}: ${errMsg(err)}`);
    return null;
  }
  // The answer must be about the object id we asked for.
  if (!entraUser || entraUser.id?.toLowerCase() !== aadObjectId) return null;
  const email = assertedEmailOf(entraUser);
  if (!email) {
    log.info(`[teams-identity] directory entry not linkable account=${account.id} sender=${senderId}`);
    return null;
  }

  // (email, org) is one person here (lib/identity-resolution.ts). Two users
  // on one address is a collision to fix, not a coin to toss.
  const users = await prisma.user.findMany({
    where: { orgId: account.orgId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (users.length !== 1) {
    log.info(`[teams-identity] no single org user for sender account=${account.id} sender=${senderId} matches=${users.length}`);
    return null;
  }
  const userId = users[0]!.id;

  await linkSenderToUser({ surfaceId: account.surfaceId, senderId, orgId: account.orgId, userId });
  await writeAuditLog({
    actorUserId: userId,
    eventType: "CHANNEL_IDENTITY_LINKED",
    targetId: senderId,
    description: "Linked a Microsoft Teams sender to their user by the sign-in name Microsoft asserts",
    metadata: {
      channel: "teams",
      orgId: account.orgId,
      accountId: account.id,
      tenantId,
      aadObjectId,
      method: "entra-graph-upn",
      userPrincipalName: email,
    },
  });
  log.info(`[teams-identity] linked account=${account.id} sender=${senderId} user=${userId}`);
  return userId;
}
