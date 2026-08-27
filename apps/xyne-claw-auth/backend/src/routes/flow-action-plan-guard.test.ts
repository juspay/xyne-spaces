import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const flowActionSrc = readFileSync(resolve(here, "./flow-action.ts"), "utf8");
const webhookSrc = readFileSync(resolve(here, "./webhook.ts"), "utf8");

// Regression pin for the 2026-08-19 "App backend error 409" incident: the
// plan-approval staleness guard (introduced in the 2026-08-18 sync) required
// priorCtx.pendingPlan — a field Turn-1 NEVER writes for a non-trivial plan
// (webhook.ts /result stores only { ...ctx, planMessageId }; pendingPlan is
// first written when Turn 2 is dispatched). Every Approve/Reject click on a
// proposed plan card therefore 409'd as "stale or missing server plan".
//
// The guard was subsequently rebuilt on the durable AgentWidgetBinding row so a
// plan stays approvable after the 24h Redis TTL. That moved WHICH server record
// pins the card, so the assertions below track the records that exist now —
// the incident itself is still pinned by the first test.

describe("plan-approval staleness guard", () => {
  const guard = flowActionSrc.slice(
    flowActionSrc.indexOf("A plan action must target the exact outstanding server-created card"),
    flowActionSrc.indexOf("const planAgentSlug"),
  );

  it("does not require ctx.pendingPlan, which Turn-1 never writes", () => {
    expect(guard).not.toContain("priorCtx.pendingPlan");
  });

  it("still pins the exact card on the server's own records", () => {
    // Anti-substitution: a click whose messageId doesn't match the live
    // active-card record is a superseded card and must be refused.
    expect(guard).toContain("activePlan.messageId !== messageId");
    // The durable row is the authority on liveness — superseded / already
    // approved / already rejected can never be re-actioned.
    expect(guard).toContain('planBinding.status !== "proposed"');
    // And the todos the dispatch trusts must actually exist on a server record.
    expect(guard).toContain("activePlan?.todos?.length");
    expect(guard).toContain("bindingData");
  });

  it("does NOT gate on the 24h session, so a plan stays approvable for days", () => {
    // The SessionContext (and its planMessageId) expires with Redis while the
    // card in the thread does not. Requiring either here is what made an old
    // but perfectly valid plan card un-approvable — the durable binding carries
    // the routing and the plan owner instead. Re-adding either of these
    // re-breaks approval after 24h.
    expect(guard).not.toContain("priorCtx.planMessageId !== messageId");
    expect(guard).not.toContain("!priorCtx ||");
  });

  it("matches Turn-1's actual writes: planMessageId-only session AND a durable binding", () => {
    // If someone later makes Turn-1 persist pendingPlan, this documents the
    // current contract they're changing: the proposed-plan /result write is
    // planMessageId-only.
    expect(webhookSrc).toContain("await setSession(sessionId, { ...ctx, planMessageId }).catch(() => {});");
    // Durability rests entirely on this write — without it the guard silently
    // degrades back to Redis-only, 24h-lifetime approval.
    expect(webhookSrc).toContain("await upsertPlanBinding({");
  });
});
