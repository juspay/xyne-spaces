/**
 * Shared request resolution for the messaging admin API. Every account route
 * answers the same questions first — which channel, who is calling, may they
 * touch this account — and the enumeration guard lives here ONCE.
 *
 * SECURITY: a missing account and a not-authorised account both answer 404
 * with the same message; a 403 would confirm that an account exists in an org
 * the caller cannot see. Do not "correct" this to 403.
 */
import type { Request } from "express";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../../../middleware/agent-acl.js";
import { getChannel, type AnyChannelPlugin } from "../plugin.js";
import { parseAccountConfig } from "../schema.js";
import { getAccount, type AccountRow } from "../store.js";

export function channelOf(req: Request): AnyChannelPlugin | undefined {
  const key = typeof req.params["channel"] === "string" ? req.params["channel"] : "";
  return getChannel(key);
}

export function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export type OrgAdminResolution =
  | { ok: true; userId: string; orgId: string; platformAdmin: boolean }
  | { ok: false; status: number; error: string };

/** Caller must be an admin of the requested org (body/query orgId, else the
 *  session org), or a platform admin. */
async function resolveOrgAdmin(req: Request): Promise<OrgAdminResolution> {
  const userId = getRequesterId(req);
  const sessionOrgId = getOrgId(req);
  if (!userId || !sessionOrgId) return { ok: false, status: 401, error: "Authenticated organization session required" };
  const body = objectPayload(req.body);
  const fromBody = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : "";
  const fromQuery = typeof req.query["orgId"] === "string" ? req.query["orgId"].trim() : "";
  const orgId = fromBody || fromQuery || sessionOrgId;
  const platformAdmin = await isClawAdmin(userId);
  if (!platformAdmin && (orgId !== sessionOrgId || !(await isOrgAdmin(userId, orgId)))) {
    return { ok: false, status: 403, error: "Organization admin required" };
  }
  return { ok: true, userId, orgId, platformAdmin };
}

export type AccountResolution =
  | {
      ok: true;
      userId: string;
      account: AccountRow;
      plugin: AnyChannelPlugin;
      /** True when access came from owning the account rather than from being
       *  an admin. Such a caller may manage their own number but must not be
       *  able to aim it at anyone else. */
      viaOwnership: boolean;
    }
  | { ok: false; status: number; error: string };

export async function resolveAccountRequest(req: Request): Promise<AccountResolution> {
  const plugin = channelOf(req);
  if (!plugin) return { ok: false, status: 404, error: "Unknown channel" };
  const userId = getRequesterId(req);
  const sessionOrgId = getOrgId(req);
  if (!userId || !sessionOrgId) return { ok: false, status: 401, error: "Authenticated organization session required" };

  const accountId = typeof req.params["id"] === "string" ? req.params["id"] : "";
  const account = accountId ? await getAccount(accountId) : null;
  if (!account || account.surface.key !== plugin.key || account.status !== "ACTIVE") {
    return { ok: false, status: 404, error: "Account not found" };
  }
  // On a user-scoped channel the account IS someone's own number, so its
  // owner manages it without being an admin. Everyone else — including other
  // members of the same org — gets the same 404 as a stranger.
  const owned =
    plugin.accountScope === "user" &&
    sessionOrgId === account.orgId &&
    parseAccountConfig(account.config).ownerUserId === userId;
  if (!owned) {
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== account.orgId || !(await isOrgAdmin(userId, account.orgId)))) {
      return { ok: false, status: 404, error: "Account not found" };
    }
  }
  return { ok: true, userId, account, plugin, viaOwnership: owned };
}

/** Who may create and list accounts on this channel: an org admin always, and
 *  on a user-scoped channel any member acting for themselves. */
export type MemberResolution =
  | { ok: true; userId: string; orgId: string; isAdmin: boolean }
  | { ok: false; status: number; error: string };

export async function resolveAccountAuthor(req: Request, plugin: AnyChannelPlugin): Promise<MemberResolution> {
  const admin = await resolveOrgAdmin(req);
  if (admin.ok) return { ok: true, userId: admin.userId, orgId: admin.orgId, isAdmin: true };
  if (plugin.accountScope !== "user") return admin;
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) return { ok: false, status: 401, error: "Authenticated organization session required" };
  return { ok: true, userId, orgId, isAdmin: false };
}
