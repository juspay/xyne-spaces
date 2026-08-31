import { describe, expect, it } from "vitest";
import { buildChartFlow, buildCodeFlow, buildDiffFlow, buildTicketFlow, buildTicketProposalFlow } from "./builder.js";

describe("buildCodeFlow", () => {
  it("emits one static code component with no action surface", () => {
    const flow = buildCodeFlow("const a = 1;\n", "typescript");

    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({
      id: "code",
      type: "code",
      props: { code: "const a = 1;\n", language: "typescript" },
    });
    // `data` carries only the preview line — never an action surface.
    expect(flow.data).toEqual({ kind: "code", fallbackText: "typescript snippet · 2 lines" });
    expect(flow.components[0]?.props).not.toHaveProperty("submitAction");
  });

  it("omits language when absent rather than emitting an empty one", () => {
    const flow = buildCodeFlow("plain text");
    expect(flow.components[0]?.props).not.toHaveProperty("language");
  });

  // Without fallbackText the stored message preview renders the literal
  // "Flow JSON" (apps/backend chatController falls back through
  // data.fallbackText → title → "Flow JSON", and these flows set no title).
  it("carries a preview line even with no language", () => {
    const flow = buildCodeFlow("one line");
    expect(flow.data).toMatchObject({ fallbackText: "snippet · 1 line" });
  });
});

describe("buildDiffFlow", () => {
  const hunk = "@@ -41,2 +41,3 @@\n-messaging.onTokenRefresh(noop);\n+messaging.onTokenRefresh((t) => registerDevice(t));\n";

  it("adds file headers to a bare hunk list so the patch parses", () => {
    const flow = buildDiffFlow("src/push/token.ts", hunk);

    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({ id: "diff", type: "diff" });
    const props = flow.components[0]?.props as { path: string; patch: string };
    expect(props.path).toBe("src/push/token.ts");
    expect(props.patch).toBe(`--- a/src/push/token.ts\n+++ b/src/push/token.ts\n${hunk}`);
    // Preview line only — no action surface on a display-only card.
    expect(flow.data).toEqual({ kind: "diff", fallbackText: "src/push/token.ts · +1/−1" });
  });

  it("still adds headers when a hunk body line looks like a file header", () => {
    const sqlHunk = "@@ -1,2 +1,1 @@\n SELECT 1;\n--- TODO: remove this\n";
    const flow = buildDiffFlow("db/migrations/002.sql", sqlHunk);
    const { patch } = flow.components[0]?.props as { patch: string };
    expect(patch.startsWith("--- a/db/migrations/002.sql\n+++ b/db/migrations/002.sql\n")).toBe(true);
  });

  it("leaves an already-headed patch untouched", () => {
    const full = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n${hunk}`;
    const flow = buildDiffFlow("x.ts", full);
    expect((flow.components[0]?.props as { patch: string }).patch).toBe(full);
  });

  it("truncates a runaway patch with a visible marker", () => {
    const huge = `@@ -1,1 +1,1 @@\n${"+x\n".repeat(20_000)}`;
    const flow = buildDiffFlow("big.ts", huge);
    const { patch } = flow.components[0]?.props as { patch: string };
    expect(patch.length).toBeLessThan(huge.length);
    expect(patch.endsWith("… diff truncated")).toBe(true);
  });
});

describe("buildTicketFlow", () => {
  it("emits a static ticket component carrying only server-derived fields", () => {
    const flow = buildTicketFlow({
      xyneId: "XYS-0441",
      title: "Fix Android push: stale FCM token after SDK bump",
      status: "TODO",
      priority: "HIGH",
      eta: "2026-02-02T00:00:00.000Z",
      url: "/chat/dir/c1/conv1/tkt1",
    });
    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({
      id: "ticket",
      type: "ticket",
      props: { xyneId: "XYS-0441", status: "TODO", priority: "HIGH" },
    });
    expect(flow.data).toBeUndefined();
  });

  it("omits eta when the ticket has no due date", () => {
    const flow = buildTicketFlow({
      xyneId: "XYS-0442",
      title: "No due date",
      status: "STARTED",
      priority: "LOW",
      url: "/chat/dir/c1/conv1/tkt2",
    });
    expect(flow.components[0]?.props).not.toHaveProperty("eta");
  });
});

describe("buildTicketProposalFlow", () => {
  const action = {
    serverType: "xyne-spaces",
    tool: "spaces-create-ticket",
    params: { title: "Fix Android push" },
    userId: "u1",
    signature: "sig",
    agentSlug: "agent",
    channelId: "c1",
    conversationId: "conv1",
  };

  it("emits a proposed ticket card with the write-approval actions and no xyneId", () => {
    const flow = buildTicketProposalFlow(
      {
        title: "Fix Android push: stale FCM token after SDK bump",
        priority: "HIGH",
        eta: "2026-02-02T00:00:00.000Z",
        assigneeId: "user-1",
      },
      action,
    );

    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({
      id: "ticket",
      type: "ticket",
      props: {
        phase: "proposed",
        status: "TODO",
        priority: "HIGH",
        assigneeId: "user-1",
        approveAction: { type: "submit", actionId: "approve-write" },
        approveContinueAction: { type: "submit", actionId: "approve-continue" },
        declineAction: { type: "submit", actionId: "decline-write" },
      },
    });
    expect(flow.components[0]?.props).not.toHaveProperty("xyneId");
    expect(flow.components[0]?.props).not.toHaveProperty("url");
  });

  it("carries the same action data as the generic write-approval card", () => {
    const flow = buildTicketProposalFlow({ title: "No due date" }, action);
    expect(flow.data).toMatchObject({
      actionType: "write",
      serverType: "xyne-spaces",
      tool: "spaces-create-ticket",
      params: JSON.stringify(action.params),
      userId: "u1",
      signature: "sig",
      agentSlug: "agent",
    });
    expect(flow.components[0]?.props).toMatchObject({ priority: "MEDIUM" });
    expect(flow.components[0]?.props).not.toHaveProperty("eta");
  });
});

describe("buildChartFlow", () => {
  it("preserves the caller's point order rather than sorting", () => {
    const points = [
      { label: "Mon", value: 31 },
      { label: "Tue", value: 2100 },
      { label: "Wed", value: 4800 },
    ];
    const flow = buildChartFlow({ type: "bar", points, caption: "Push failures per day" });
    expect(flow.components[0]?.props).toMatchObject({
      type: "bar",
      points,
      caption: "Push failures per day",
    });
  });

  it("caps category charts so one call can't emit an unbounded chart", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `d${i}`, value: i }));
    const flow = buildChartFlow({ type: "bar", points: many });
    const { points } = flow.components[0]?.props as { points: unknown[] };
    expect(points).toHaveLength(24);
  });

  it("carries multi-series line data under `series`, not `points`", () => {
    const series = [
      { x: "Mon", y: 1, series: "android" },
      { x: "Mon", y: 2, series: "ios" },
    ];
    const flow = buildChartFlow({ type: "line", series });
    expect(flow.components[0]?.props).toMatchObject({ type: "line", series });
    expect(flow.components[0]?.props).not.toHaveProperty("points");
  });

  it("omits caption when absent", () => {
    const flow = buildChartFlow({ type: "donut", points: [{ label: "a", value: 1 }] });
    expect(flow.components[0]?.props).not.toHaveProperty("caption");
  });

  it("uses the caption as the preview line — it carries the takeaway", () => {
    const flow = buildChartFlow({
      type: "bar",
      points: [{ label: "Mon", value: 1 }],
      caption: "Push failures per day",
    });
    expect(flow.data).toMatchObject({ kind: "chart", fallbackText: "Push failures per day" });
  });

  it("falls back to the chart shape when the agent omitted a caption", () => {
    const flow = buildChartFlow({
      type: "line",
      series: [{ x: "Mon", y: 1 }, { x: "Tue", y: 2 }],
    });
    expect(flow.data).toMatchObject({ fallbackText: "line chart · 2 points" });
  });

  it("counts the capped points, not the caller's, in the preview line", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `d${i}`, value: i }));
    const flow = buildChartFlow({ type: "bar", points: many });
    expect(flow.data).toMatchObject({ fallbackText: "bar chart · 24 points" });
  });
});
