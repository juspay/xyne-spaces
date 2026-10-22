import { describe, expect, it } from "vitest";
import {
  buildWriteBatchApprovalFlow,
  parseWriteBatchRowActionId,
  parseWriteBatchRows,
  writeBatchFallbackText,
  type WriteBatchRow,
} from "./write-batch-flow.js";

const action = (tool: string) => ({
  serverType: "jira",
  tool,
  params: { summary: tool },
  userId: "u1",
  signature: `sig-${tool}`,
  agentSlug: "doctor",
  channelId: "ch",
  conversationId: "conv",
});

const rows = (): WriteBatchRow[] => [
  { description: "Create issue A", action: action("a"), status: "pending" },
  { description: "Create issue B", action: action("b"), status: "pending" },
  { description: "Create issue C", action: action("c"), status: "pending" },
];

function buttons(flow: ReturnType<typeof buildWriteBatchApprovalFlow>): string[] {
  const out: string[] = [];
  const walk = (cs: Array<{ type: string; props?: Record<string, unknown>; children?: unknown[] }> = []) => {
    for (const c of cs) {
      if (c.type === "button") out.push(String((c.props?.["action"] as { actionId: string }).actionId));
      walk(c.children as never);
    }
  };
  walk(flow.components as never);
  return out;
}

describe("write batch approval card", () => {
  it("offers per-row approve/decline and the all-actions when everything is pending", () => {
    const flow = buildWriteBatchApprovalFlow({ batchId: "b1", rows: rows() });
    expect(buttons(flow)).toEqual([
      "approve-row:0", "decline-row:0",
      "approve-row:1", "decline-row:1",
      "approve-row:2", "decline-row:2",
      "approve-all", "approve-all-continue", "decline-all",
    ]);
    expect(flow.data?.["actionType"]).toBe("write-batch");
    expect(flow.data?.["fallbackText"]).toBe("3 actions waiting for approval");
  });

  it("drops buttons from decided rows, offers Retry on a retryable failure, and hides the all-actions with one row left", () => {
    const r = rows();
    r[0] = { ...r[0]!, status: "done", resultText: "Created XYNE-1" };
    r[1] = { ...r[1]!, status: "failed", resultText: "Jira 500", retryable: true };
    const flow = buildWriteBatchApprovalFlow({ batchId: "b1", rows: r });
    expect(buttons(flow)).toEqual(["approve-row:1", "approve-row:2", "decline-row:2"]);
    expect(writeBatchFallbackText(r)).toBe("Approvals · 1 done · 1 failed · 1 waiting");
  });

  it("round-trips rows through card data and always parses them back as pending", () => {
    const r = rows();
    r[0] = { ...r[0]!, status: "done" };
    const flow = buildWriteBatchApprovalFlow({ batchId: "b1", rows: r });
    const parsed = parseWriteBatchRows(flow.data?.["rows"]);
    expect(parsed?.map((x) => x.status)).toEqual(["pending", "pending", "pending"]);
    expect(parsed?.[1]?.action).toEqual(action("b"));
  });

  it("rejects malformed row data", () => {
    expect(parseWriteBatchRows("not json")).toBeNull();
    expect(parseWriteBatchRows(JSON.stringify([{ description: "x" }]))).toBeNull();
    expect(parseWriteBatchRows(JSON.stringify([]))).toBeNull();
    expect(parseWriteBatchRows(JSON.stringify([{ description: "x", action: { ...action("a"), params: "str" } }]))).toBeNull();
  });

  it("parses only well-formed row action ids", () => {
    expect(parseWriteBatchRowActionId("approve-row:2")).toEqual({ kind: "approve", index: 2 });
    expect(parseWriteBatchRowActionId("decline-row:0")).toEqual({ kind: "decline", index: 0 });
    expect(parseWriteBatchRowActionId("approve-row:-1")).toBeNull();
    expect(parseWriteBatchRowActionId("approve-row:1;x")).toBeNull();
  });
});
