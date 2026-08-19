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

describe("plan-approval staleness guard", () => {
  const guard = flowActionSrc.slice(
    flowActionSrc.indexOf("A plan action must target the exact outstanding server-created card"),
    flowActionSrc.indexOf("const planAgentSlug"),
  );

  it("does not require ctx.pendingPlan, which Turn-1 never writes", () => {
    expect(guard).not.toContain("priorCtx.pendingPlan");
  });

  it("still pins the exact card on both server records", () => {
    // Anti-substitution: the click's messageId must match BOTH the active-card
    // record and the conv-indexed session context.
    expect(guard).toContain("activePlan.messageId !== messageId");
    expect(guard).toContain("priorCtx.planMessageId !== messageId");
    // And the todos the dispatch trusts (serverTodos) must actually exist.
    expect(guard).toContain("!activePlan.todos.length");
  });

  it("matches Turn-1's actual session write (no pendingPlan on the proposed path)", () => {
    // If someone later makes Turn-1 persist pendingPlan, this documents the
    // current contract they're changing: the proposed-plan /result write is
    // planMessageId-only.
    expect(webhookSrc).toContain("await setSession(sessionId, { ...ctx, planMessageId }).catch(() => {});");
  });
});
