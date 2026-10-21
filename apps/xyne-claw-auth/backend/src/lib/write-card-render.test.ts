import { describe, expect, it } from "vitest";
import { buildWriteResultFlow } from "xyne-claw-shared";

// Real HMAC round-trips (routes/mcp.ts signing), so the subagent binding is
// checked against the same keys and canonical payload production uses.
const { signAction, verifyActionSignature, writeActionPayload } = await import("../routes/mcp.js");
const { buildWriteApprovalCardFlow, mintWriteCardAction, readPendingWriteAction } = await import("./write-card-render.js");

const base = {
  serverType: "juspay-dashboard-stream",
  tool: "create_payout_order",
  params: { amount: 1, customerId: "c1" },
  userId: "user-1",
};
const identity = { agentSlug: "ny-payments", spacesAppId: "" };

/** A pending action as /mcp/call returns it, round-tripped through JSON. */
function pending(
  subagentId?: string,
  over: { serverType?: string; tool?: string; params?: Record<string, unknown> } = {},
): unknown {
  const core = writeActionPayload({ ...base, ...over, subagentId });
  return JSON.parse(JSON.stringify({ ...core, signature: signAction(core) }));
}

describe("write action signing — subagent binding", () => {
  it("keeps the four-field payload for a write no subagent decided", () => {
    const action = readPendingWriteAction(pending())!;

    expect(Object.keys(writeActionPayload(action)).sort()).toEqual(["params", "serverType", "tool", "userId"]);
    expect(verifyActionSignature({ ...base }, action.signature)).toBe(true);
  });

  it("binds the subagent: dropping it or swapping it fails verification", () => {
    const action = readPendingWriteAction(pending("sub-a"))!;

    expect(verifyActionSignature(writeActionPayload(action), action.signature)).toBe(true);
    expect(verifyActionSignature({ ...base }, action.signature)).toBe(false);
    expect(verifyActionSignature(writeActionPayload({ ...action, subagentId: "sub-b" }), action.signature)).toBe(false);
  });
});

describe("mintWriteCardAction — carries the subagent onto the approval card", () => {
  it("signs the subagent into the card and puts it in the card data flow-action reads", async () => {
    const action = readPendingWriteAction(pending("sub-a"))!;
    expect(action.subagentId).toBe("sub-a");

    const card = await mintWriteCardAction(action, identity);

    expect(card.subagentId).toBe("sub-a");
    expect(verifyActionSignature({ ...writeActionPayload(card), ...identity }, card.signature)).toBe(true);
    expect(verifyActionSignature({ ...base, ...identity }, card.signature)).toBe(false);
    expect((await buildWriteApprovalCardFlow(card, "Create payout", null)).flow.data?.["subagentId"]).toBe("sub-a");
  });

  it("keeps it on the ticket proposal card too", async () => {
    const action = readPendingWriteAction(
      pending("sub-a", { serverType: "xyne-spaces", tool: "spaces-create-ticket", params: { title: "Refund" } }),
    )!;

    const { flow, usedRichCard } = await buildWriteApprovalCardFlow(await mintWriteCardAction(action, identity), "Create ticket", null);

    expect(usedRichCard).toBe(true);
    expect(flow.data?.["subagentId"]).toBe("sub-a");
  });

  it("refuses a pending action whose subagent was swapped after signing", async () => {
    const swapped = readPendingWriteAction({ ...(pending("sub-a") as object), subagentId: "sub-b" })!;

    await expect(mintWriteCardAction(swapped, identity)).rejects.toThrow(/signature/);
  });

  it("leaves cards for ordinary writes exactly as before", async () => {
    const card = await mintWriteCardAction(readPendingWriteAction(pending())!, identity);

    expect("subagentId" in card).toBe(false);
    expect(Object.keys((await buildWriteApprovalCardFlow(card, "Create payout", null)).flow.data ?? {})).not.toContain("subagentId");
  });
});

describe("buildWriteResultFlow — retry re-submits the signed subagent", () => {
  it("puts the subagent on the retry card's data", () => {
    const flow = buildWriteResultFlow({
      tool: base.tool,
      ok: false,
      heading: "failed",
      details: [],
      retry: { serverType: base.serverType, params: base.params, userId: base.userId, signature: "sig", agentSlug: "ny-payments", subagentId: "sub-a" },
    });

    expect(flow.data?.["subagentId"]).toBe("sub-a");
  });
});
