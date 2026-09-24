/**
 * "My number" — self-service linking for every org member, not admins.
 *
 * One question, asked by someone already signed in to Claw: "here is my phone
 * number, make messages from it run as me." No admin approval and no
 * confirmation from the phone — the session says who the caller is, and the
 * number they type is taken at face value (see linkNumber in identity.ts for
 * what that does and does not protect).
 *
 * The link belongs to the person, not to an assistant: it is recognised by
 * every account on the channel in their org, including a colleague's personal
 * number they @mention in a group.
 *
 * Every route is org-scoped to the caller's session and only ever touches the
 * caller's own identity rows.
 */
import { Router, type Request, type Response } from "express";
import { getOrgId, getRequesterId } from "../../../middleware/agent-acl.js";
import { linkNumber, LinkError } from "../identity.js";
import { linkNumberBodySchema } from "../schema.js";
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

/** The numbers the caller has linked on this channel. */
router.get("/my-numbers", async (req: Request, res: Response) => {
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const identities = await listIdentitiesForUser({ surfaceId, userId: caller.userId, orgId: caller.orgId });
  // Links made before they were per-person can repeat a number once per
  // account; the person has one number, so show it once.
  const seen = new Set<string>();
  res.json({
    success: true,
    numbers: identities
      .filter((identity) => !seen.has(identity.surfaceUserId) && seen.add(identity.surfaceUserId))
      .map((identity) => ({
        senderId: identity.surfaceUserId,
        linkedAt: identity.linkedAt,
        lastSeenAt: identity.lastSeenAt,
      })),
  });
});

/** "This is my number." Links it to the caller immediately — the signed-in
 *  session is the identity, and the number says which sender id it answers to. */
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
    const linked = await linkNumber({
      plugin: channelOf(req)!,
      surfaceId,
      orgId: caller.orgId,
      phone: body.data.phone,
      userId: caller.userId,
    });
    res.json({
      success: true,
      linked: { senderId: linked.senderId, sendTo: linked.sendTo, linkedAt: linked.linkedAt.toISOString() },
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
  const caller = callerOf(req, res);
  if (!caller) return;
  const surfaceId = await surfaceIdOf(req, res);
  if (!surfaceId) return;
  const senderId = typeof req.params["senderId"] === "string" ? decodeURIComponent(req.params["senderId"]) : "";
  const result = await unlinkOwnIdentity({ surfaceId, senderId, userId: caller.userId, orgId: caller.orgId });
  res.json({ success: true, removed: result.count });
});
