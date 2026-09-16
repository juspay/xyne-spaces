/**
 * "My number" — self-service linking for ordinary org members, not admins.
 *
 * The admin routes in pairings.ts answer "who is asking to be let in?". These
 * answer the opposite question, asked by someone already signed in to Claw:
 * "here is my phone number, make messages from it run as me." No admin and no
 * confirmation from the phone — the session says who the caller is, and the
 * number they type is taken at face value (see linkNumber in pairing.ts for
 * what that does and does not protect).
 *
 * Every route is org-scoped to the caller's session and only ever touches the
 * caller's own identity rows.
 */
import { Router, type Request, type Response } from "express";
import { getOrgId, getRequesterId } from "../../../middleware/agent-acl.js";
import { linkNumber, LinkError } from "../identity.js";
import type { AnyChannelPlugin } from "../plugin.js";
import { linkNumberBodySchema } from "../schema.js";
import { channelOf } from "./context.js";
import { listIdentitiesForUser, listOrgAccounts, listOwnedAccounts, toChannelAccount, unlinkOwnIdentity } from "../store.js";

export const numbersRouter = Router({ mergeParams: true });
const router = numbersRouter;

type Caller = { userId: string; orgId: string };

/** Org-scoped: every account in the org. User-scoped: only the caller's own. */
function accountsFor(plugin: AnyChannelPlugin, caller: Caller) {
  return plugin.accountScope === "user"
    ? listOwnedAccounts(plugin.key, caller.orgId, caller.userId)
    : listOrgAccounts(plugin.key, caller.orgId);
}

function callerOf(req: Request, res: Response): Caller | null {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) {
    res.status(401).json({ success: false, error: "Authenticated organization session required" });
    return null;
  }
  return { userId, orgId };
}

/**
 * The accounts a number can be linked to. Not the admin account list: it
 * carries only what someone needs to pick the right assistant — no policy, no
 * config, no secrets.
 *
 * Which accounts those are depends on the channel's scope. An org-scoped
 * channel has shared business numbers, so every account in the org is a valid
 * target. A user-scoped channel's accounts are individual people's own
 * numbers, and linking yourself into a colleague's personal assistant is not a
 * thing — only your own are offered.
 */
router.get("/my-numbers/accounts", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  const caller = callerOf(req, res);
  if (!plugin || !caller) return;
  if (!plugin.senderIdFromPhone) {
    res.json({ success: true, accounts: [] });
    return;
  }
  const rows = await accountsFor(plugin, caller);
  res.json({
    success: true,
    accounts: rows.map((row) => {
      const account = toChannelAccount(row);
      return {
        id: account.id,
        label: account.config.label,
        number: account.config.displayId ?? null,
        connected: account.config.connState === "connected",
      };
    }),
  });
});

/** The numbers the caller has already linked on this channel. */
router.get("/my-numbers", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  const caller = callerOf(req, res);
  if (!plugin || !caller) return;
  const rows = await accountsFor(plugin, caller);
  const accounts = rows.map(toChannelAccount);
  const accountsByKey = new Map(accounts.map((account) => [account.accountKey, account]));
  const surfaceId = accounts[0]?.surfaceId ?? plugin.key;
  const identities = await listIdentitiesForUser({ surfaceId, userId: caller.userId, orgId: caller.orgId });
  res.json({
    success: true,
    numbers: identities
      .filter((identity) => accountsByKey.has(identity.surfaceWorkspaceId))
      .map((identity) => ({
        senderId: identity.surfaceUserId,
        accountLabel: accountsByKey.get(identity.surfaceWorkspaceId)?.config.label ?? null,
        accountId: accountsByKey.get(identity.surfaceWorkspaceId)?.id ?? null,
        linkedAt: identity.linkedAt,
        lastSeenAt: identity.lastSeenAt,
      })),
  });
});

/** "This is my number." Links it to the caller immediately — the signed-in
 *  session is the identity, and the number says which sender id it answers to. */
router.post("/my-numbers", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  const caller = callerOf(req, res);
  if (!plugin || !caller) return;
  const body = linkNumberBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.message });
    return;
  }

  const rows = await accountsFor(plugin, caller);
  const row = body.data.accountId
    ? rows.find((candidate) => candidate.id === body.data.accountId)
    : rows.length === 1
      ? rows[0]
      : undefined;
  if (!row) {
    res.status(rows.length === 0 ? 404 : 400).json({
      success: false,
      error: rows.length === 0 ? "No assistant is connected for this channel yet." : "Choose which assistant to link to.",
    });
    return;
  }

  try {
    const linked = await linkNumber({
      account: toChannelAccount(row),
      plugin,
      phone: body.data.phone,
      userId: caller.userId,
    });
    res.json({
      success: true,
      // The sender id is the normalised number, and it is the caller's own, so
      // there is nothing to mask here.
      linked: {
        senderId: linked.senderId,
        accountId: linked.accountId,
        accountLabel: linked.accountLabel,
        sendTo: linked.sendTo,
        linkedAt: linked.linkedAt.toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }
});

/** Unlink one of the caller's own numbers. Scoped to their identity rows, so
 *  this can never remove someone else's link even with a guessed sender id. */
router.delete("/my-numbers/:senderId", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  const caller = callerOf(req, res);
  if (!plugin || !caller) return;
  const senderId = typeof req.params["senderId"] === "string" ? decodeURIComponent(req.params["senderId"]) : "";
  const rows = await accountsFor(plugin, caller);
  const surfaceId = rows[0] ? toChannelAccount(rows[0]).surfaceId : plugin.key;
  const result = await unlinkOwnIdentity({ surfaceId, senderId, userId: caller.userId, orgId: caller.orgId });
  res.json({ success: true, removed: result.count });
});
