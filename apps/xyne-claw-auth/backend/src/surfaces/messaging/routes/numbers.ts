/**
 * "My number" — self-service linking for every org member, not admins.
 *
 * One question, asked by someone already signed in to Claw: "here is my phone
 * number, make messages from it run as me." No admin approval, but the phone
 * has to confirm it: POST /my-numbers sends a one-time code to the number, and
 * POST /my-numbers/confirm links it once that code comes back (see
 * requestNumberCode / confirmNumber in identity.ts). A typed number alone
 * proves nothing, and a link decides whose data a message runs against.
 *
 * The link belongs to the person, not to an assistant: it is recognised by
 * every account on the channel in their org, including a colleague's personal
 * number they @mention in a group.
 *
 * Every route is org-scoped to the caller's session and only ever touches the
 * caller's own identity rows — apart from a confirmed code, which may replace
 * somebody else's UNVERIFIED claim on the same number (a reclaim, audited).
 */
import { Router, type Request, type Response } from "express";
import { getOrgId, getRequesterId } from "../../../middleware/agent-acl.js";
import { auditNumberLink, confirmNumber, LinkError, requestNumberCode } from "../identity.js";
import { confirmNumberBodySchema, linkNumberBodySchema } from "../schema.js";
import { channelOf } from "./context.js";
import { getSurface, listIdentitiesForUser, unlinkOwnIdentity } from "../store.js";

export const numbersRouter = Router({ mergeParams: true });
const router = numbersRouter;

type Caller = { userId: string; orgId: string };

function callerOf(req: Request, res: Response): Caller | null {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) {
    res.status(401).json({ success: false, error: "Authenticated organization session required" });
    return null;
  }
  return { userId, orgId };
}

/** The channel's surface row, or a 404 when this deployment has not seeded it. */
async function surfaceIdOf(req: Request, res: Response): Promise<string | null> {
  const plugin = channelOf(req);
  const surface = plugin ? await getSurface(plugin.key) : null;
  if (!plugin || !surface || surface.status !== "ACTIVE" || !plugin.senderIdFromPhone) {
    res.status(404).json({ success: false, error: "Number linking is not available on this channel." });
    return null;
  }
  return surface.id;
}

function sendLinkError(res: Response, err: unknown): void {
  if (err instanceof LinkError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  throw err;
}

/** The numbers the caller has linked on this channel. `verified: false` is a
 *  link made before verification existed: it does nothing until confirmed. */
router.get("/my-numbers", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const identities = await listIdentitiesForUser({ surfaceId, userId: caller.userId, orgId: caller.orgId });
  // Links made before they were per-person can repeat a number once per
  // account; the person has one number, so show it once — verified if any
  // of its rows is.
  const byNumber = new Map<string, (typeof identities)[number]>();
  for (const identity of identities) {
    const seen = byNumber.get(identity.surfaceUserId);
    if (!seen || (!seen.verifiedAt && identity.verifiedAt)) byNumber.set(identity.surfaceUserId, identity);
  }
  res.json({
    success: true,
    numbers: [...byNumber.values()].map((identity) => ({
      senderId: identity.surfaceUserId,
      linkedAt: identity.linkedAt,
      lastSeenAt: identity.lastSeenAt,
      verified: identity.verifiedAt !== null,
    })),
  });
});

/** "This is my number." Sends a one-time code to it; nothing is linked yet. */
router.post("/my-numbers", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const body = linkNumberBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.message });
    return;
  }
  try {
    const pending = await requestNumberCode({
      plugin: channelOf(req)!,
      surfaceId,
      orgId: caller.orgId,
      phone: body.data.phone,
      userId: caller.userId,
    });
    res.status(202).json({ success: true, verification: { expiresAt: pending.expiresAt.toISOString() } });
  } catch (err) {
    sendLinkError(res, err);
  }
});

/** "Here is the code." Links the number to the caller once it checks out. */
router.post("/my-numbers/confirm", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const body = confirmNumberBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.issues[0]?.message ?? body.error.message });
    return;
  }
  try {
    const linked = await confirmNumber({
      plugin: channelOf(req)!,
      orgId: caller.orgId,
      phone: body.data.phone,
      code: body.data.code,
      userId: caller.userId,
    });
    res.json({
      success: true,
      linked: { senderId: linked.senderId, sendTo: linked.sendTo, linkedAt: linked.linkedAt.toISOString() },
    });
  } catch (err) {
    sendLinkError(res, err);
  }
});

/** Unlink one of the caller's own numbers. Scoped to their identity rows, so
 *  this can never remove someone else's link even with a guessed sender id. */
router.delete("/my-numbers/:senderId", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const senderId = typeof req.params["senderId"] === "string" ? decodeURIComponent(req.params["senderId"]) : "";
  const result = await unlinkOwnIdentity({ surfaceId, senderId, userId: caller.userId, orgId: caller.orgId });
  if (result.count > 0) {
    await auditNumberLink({
      event: "CHANNEL_NUMBER_UNLINKED",
      actorUserId: caller.userId,
      channel: channelOf(req)!.key,
      orgId: caller.orgId,
      senderId,
      description: "Unlinked own number",
    });
  }
  res.json({ success: true, removed: result.count });
});
