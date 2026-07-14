/**
 * Authorization for scheduled-job control actions (pause / resume / cancel).
 *
 * Extracted into its own module (no prisma / BullMQ / Redis imports) so the
 * authorization decision can be unit-tested in isolation without spinning up
 * queue connections or a database.
 *
 * Two caller shapes are supported:
 *   1. Browser session — identified via `getRequesterId` (x-user-id). Owner or
 *      claw-admin may act.
 *   2. S2S tool call — no browser session. The trusted runtime must pass
 *      `userId` + `agentSlug` from execution context; the action is clamped to
 *      the same owner+agent. When the runtime additionally passes
 *      `currentScheduledJobId` (the schedule that triggered the current turn),
 *      the action is further clamped to *that* job, so a model cannot target a
 *      sibling schedule of the same owner+agent by supplying an arbitrary
 *      `:id` in the URL.
 */

import type { Request } from "express";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";

export type ScheduledJobControlAuthResult =
  | { ok: true; actorUserId: string }
  | { ok: false; status: number; error: string };

export async function assertCanControlScheduledJob(
  req: Request,
  row: { id: string; userId: string; agentSlug: string },
): Promise<ScheduledJobControlAuthResult> {
  const requesterId = getRequesterId(req);
  if (requesterId) {
    if (row.userId === requesterId || (await isClawAdmin(requesterId))) {
      return { ok: true, actorUserId: requesterId };
    }
    return { ok: false, status: 404, error: "Not found" };
  }

  // S2S tool calls do not carry a browser session. Require the runtime to pass
  // the current user/agent from trusted execution context and clamp the action
  // to that same owner+agent. This keeps a model-supplied arbitrary job id from
  // cancelling another user's schedule.
  const body = req.body as {
    userId?: string;
    agentSlug?: string;
    currentScheduledJobId?: string;
  };
  const actorUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const actorAgentSlug =
    typeof body.agentSlug === "string" ? body.agentSlug.trim() : "";
  if (!actorUserId || !actorAgentSlug) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  if (row.userId !== actorUserId || row.agentSlug !== actorAgentSlug) {
    return { ok: false, status: 404, error: "Not found" };
  }

  // Defense in depth against a compromised/confused runtime: a scheduled run
  // is only ever entitled to control the job it is running from. When the
  // runtime supplies currentScheduledJobId (the job that triggered this turn),
  // clamp the action to that job so a model cannot target a *sibling* schedule
  // of the same owner+agent by passing an arbitrary :id in the URL. If the
  // runtime does not supply it (e.g. an interactive, non-scheduled agent run),
  // the owner+agent match above still applies.
  const currentScheduledJobId =
    typeof body.currentScheduledJobId === "string"
      ? body.currentScheduledJobId.trim()
      : "";
  if (currentScheduledJobId && currentScheduledJobId !== row.id) {
    return {
      ok: false,
      status: 403,
      error: "A scheduled run may only control its own job",
    };
  }
  return { ok: true, actorUserId };
}
