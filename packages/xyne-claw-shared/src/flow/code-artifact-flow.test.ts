import { describe, expect, it } from "vitest";
import { buildChartFlow, buildCodeFlow, buildDiffFlow, buildTicketFlow } from "./builder.js";

describe("buildCodeFlow", () => {
  it("emits one static code component with no action surface", () => {
    const flow = buildCodeFlow("const a = 1;\n", "typescript");

    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({
      id: "code",
      type: "code",
      props: { code: "const a = 1;\n", language: "typescript" },
    });
    expect(flow.data).toBeUndefined();
    expect(flow.components[0]?.props).not.toHaveProperty("submitAction");
  });

  it("omits language when absent rather than emitting an empty one", () => {
    const flow = buildCodeFlow("plain text");
    expect(flow.components[0]?.props).not.toHaveProperty("language");
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
    expect(flow.data).toBeUndefined();
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
});
