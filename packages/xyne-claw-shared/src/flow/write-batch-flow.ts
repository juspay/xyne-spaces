import { FlowBuilder, type FlowComponent, type FlowDefinition } from "./builder.js";

export const WRITE_BATCH_ACTION_TYPE = "write-batch";
export const WRITE_BATCH_SCREEN_PREFIX = "write-batch-";

export type WriteBatchRowStatus = "pending" | "running" | "done" | "failed" | "declined";

export interface WriteBatchAction {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  signature: string;
  agentSlug: string;
  subagentId?: string;
  channelId?: string;
  conversationId?: string;
}

export interface WriteBatchRow {
  description: string;
  action: WriteBatchAction;
  status: WriteBatchRowStatus;
  resultText?: string;
  retryable?: boolean;
}

const STATUS_LABEL: Record<WriteBatchRowStatus, string> = {
  pending: "⏳ Waiting for approval",
  running: "⏱ Running…",
  done: "✅ Done",
  failed: "❌ Failed",
  declined: "⛔ Declined",
};

function actionRow(id: string, children: FlowComponent[]): FlowComponent {
  return { id, type: "row", children };
}

export function writeBatchRowActionId(kind: "approve" | "decline", index: number): string {
  return `${kind}-row:${index}`;
}

export function parseWriteBatchRowActionId(actionId: string): { kind: "approve" | "decline"; index: number } | null {
  const match = /^(approve|decline)-row:(\d{1,3})$/.exec(actionId);
  if (!match) return null;
  return { kind: match[1] as "approve" | "decline", index: Number(match[2]) };
}

export function writeBatchFallbackText(rows: WriteBatchRow[]): string {
  const waiting = rows.filter((r) => r.status === "pending").length;
  const done = rows.filter((r) => r.status === "done").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  if (waiting === rows.length) return `${rows.length} actions waiting for approval`;
  const parts = [`${done} done`];
  if (failed) parts.push(`${failed} failed`);
  if (waiting) parts.push(`${waiting} waiting`);
  return `Approvals · ${parts.join(" · ")}`;
}

export function buildWriteBatchApprovalFlow(opts: {
  batchId: string;
  rows: WriteBatchRow[];
  spacesAppId?: string;
}): FlowDefinition {
  const { rows } = opts;
  const pending = rows.filter((r) => r.status === "pending").length;
  const b = new FlowBuilder(`${WRITE_BATCH_SCREEN_PREFIX}${opts.batchId}`)
    .setTitle(pending > 0 ? `Approvals (${rows.length})` : "Approvals")
    .addText(
      "intro",
      pending === rows.length
        ? `The agent wants to run ${rows.length} actions. Nothing has run yet.`
        : `${rows.length - pending} of ${rows.length} decided.`,
      { variant: "muted", size: "sm" },
    );

  rows.forEach((row, i) => {
    const children: FlowComponent[] = [
      FlowBuilder.text(`row-${i}-desc`, `**${i + 1}.** ${row.description}`),
      FlowBuilder.text(
        `row-${i}-status`,
        row.resultText ? `${STATUS_LABEL[row.status]} — ${row.resultText}` : STATUS_LABEL[row.status],
        { variant: row.status === "failed" ? "danger" : row.status === "done" ? "success" : "muted" },
      ),
    ];
    if (row.status === "pending") {
      children.push(
        actionRow(`row-${i}-actions`, [
          FlowBuilder.button(`row-${i}-approve`, "✓  Approve", { type: "submit", actionId: writeBatchRowActionId("approve", i) }, { variant: "primary" }),
          FlowBuilder.button(`row-${i}-decline`, "✕  Decline", { type: "submit", actionId: writeBatchRowActionId("decline", i) }, { variant: "destructive" }),
        ]),
      );
    } else if (row.status === "failed" && row.retryable) {
      children.push(
        actionRow(`row-${i}-actions`, [
          FlowBuilder.button(`row-${i}-retry`, "↻  Retry", { type: "submit", actionId: writeBatchRowActionId("approve", i) }, { variant: "secondary" }),
        ]),
      );
    }
    b.addCard(`row-${i}`, children, { maxHeight: "280px", overflowY: "auto" });
  });

  if (pending > 1) {
    b.addRow("all-actions", [
      FlowBuilder.button("approve-all", `✓  Approve all ${pending}`, { type: "submit", actionId: "approve-all" }, { variant: "primary" }),
      FlowBuilder.button("approve-all-continue", "✓  Approve all & continue", { type: "submit", actionId: "approve-all-continue" }, { variant: "secondary" }),
      FlowBuilder.button("decline-all", "✕  Decline all", { type: "submit", actionId: "decline-all" }, { variant: "destructive" }),
    ]);
  }

  return b
    .setData({
      actionType: WRITE_BATCH_ACTION_TYPE,
      batchId: opts.batchId,
      rows: JSON.stringify(rows),
      fallbackText: writeBatchFallbackText(rows),
      ...(opts.spacesAppId ? { spacesAppId: opts.spacesAppId } : {}),
    })
    .build();
}

export function parseWriteBatchRows(raw: unknown): WriteBatchRow[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) return null;
  const rows: WriteBatchRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const a = r["action"] as Record<string, unknown> | undefined;
    if (typeof r["description"] !== "string" || !a || typeof a !== "object") return null;
    for (const key of ["serverType", "tool", "userId", "signature", "agentSlug"]) {
      if (typeof a[key] !== "string") return null;
    }
    if (!a["params"] || typeof a["params"] !== "object" || Array.isArray(a["params"])) return null;
    rows.push({
      description: r["description"],
      action: {
        serverType: a["serverType"] as string,
        tool: a["tool"] as string,
        params: a["params"] as Record<string, unknown>,
        userId: a["userId"] as string,
        signature: a["signature"] as string,
        agentSlug: a["agentSlug"] as string,
        ...(typeof a["subagentId"] === "string" ? { subagentId: a["subagentId"] } : {}),
        ...(typeof a["channelId"] === "string" ? { channelId: a["channelId"] } : {}),
        ...(typeof a["conversationId"] === "string" ? { conversationId: a["conversationId"] } : {}),
      },
      status: "pending",
    });
  }
  return rows;
}
