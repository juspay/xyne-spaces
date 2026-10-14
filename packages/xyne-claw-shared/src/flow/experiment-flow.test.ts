import { describe, expect, it } from "vitest";
import {
  buildExperimentEpochFlow,
  buildExperimentStatusFlow,
  experimentEpochFallbackText,
  experimentEpochScreenId,
  experimentStatusScreenId,
  type ExperimentEpochCard,
  type ExperimentStatusCard,
} from "./experiment-flow.js";

const routing = { agentSlug: "architect", channelId: "ch_1", conversationId: "conv_1", userId: "u_1" };

const status: ExperimentStatusCard = {
  runId: "run_1",
  kind: "experiment",
  status: "running",
  title: "dashboard & desktop quality",
  model: "spaces (default)",
  exitRule: "Time-boxed: ends at the deadline.",
  startedAt: "2026-10-07T02:29:00.000Z",
  deadlineAt: "2026-10-07T09:29:00.000Z",
  updatedAt: "2026-10-07T07:58:00.000Z",
  epoch: 14,
  counts: { proved: 17, refuted: 0, open: 2 },
  epochs: { completed: 13, failed: 2 },
  findings: [{ title: "Entry bundle is 37 MB", status: "proved", epoch: 9, proof: "  " }],
  totalFindings: 19,
  needsYou: [],
  links: { preview: "https://example.test/p/", code: "" },
};

const epoch: ExperimentEpochCard = {
  runId: "run_1",
  epoch: 14,
  status: "running",
  hypothesis: "The entry chunk can be split by route",
  plan: [
    { id: "a", title: "Measure", status: "completed" },
    { id: "b", title: "Split", status: "in_progress" },
    { id: "c", title: "Verify", status: "pending" },
  ],
  retries: 0,
  attachments: [],
  findings: [],
  startedAt: "2026-10-07T07:40:00.000Z",
};

describe("buildExperimentStatusFlow", () => {
  it("emits one experiment_status component keyed by run", () => {
    const flow = buildExperimentStatusFlow(status, routing);
    expect(flow.screenId).toBe(experimentStatusScreenId("run_1"));
    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]!.type).toBe("experiment_status");
  });

  it("drops empty optional values so strict props validate", () => {
    const props = buildExperimentStatusFlow(status, routing).components[0]!.props as Record<string, unknown>;
    expect(props).not.toHaveProperty("focus");
    expect(props).not.toHaveProperty("endedAt");
    expect(props["links"]).toEqual({ preview: "https://example.test/p/" });
    expect((props["findings"] as Array<Record<string, unknown>>)[0]).not.toHaveProperty("proof");
  });

  it("routes card actions back to claw-auth with a readable fallback", () => {
    const data = buildExperimentStatusFlow(status, routing).data!;
    expect(data["actionType"]).toBe("experiment-card");
    expect(data["experimentId"]).toBe("run_1");
    expect(data["fallbackText"]).toBe("Experiment · Running · epoch 14 · 17 proved · 0 refuted · 2 open");
    expect(data["conversationId"]).toBe("conv_1");
  });
});

describe("buildExperimentEpochFlow", () => {
  it("maps plan statuses to the execution vocabulary", () => {
    const props = buildExperimentEpochFlow(epoch, "sess_1", routing).components[0]!.props as Record<string, unknown>;
    expect(props["plan"]).toEqual([
      { id: "a", text: "Measure", status: "done" },
      { id: "b", text: "Split", status: "running" },
      { id: "c", text: "Verify", status: "queued" },
    ]);
  });

  it("keys the screen by run and session so a re-dispatched epoch gets its own card", () => {
    expect(buildExperimentEpochFlow(epoch, "sess_1", routing).screenId).toBe(experimentEpochScreenId("run_1", "sess_1"));
    expect(experimentEpochScreenId("run_1", "sess_1")).not.toBe(experimentEpochScreenId("run_1", "sess_2"));
  });

  it("summarises the epoch in its fallback text", () => {
    expect(experimentEpochFallbackText(epoch)).toBe("Epoch 14 · running — The entry chunk can be split by route");
    expect(experimentEpochFallbackText({ ...epoch, status: "done", summary: "\nBundle −70%\nmore" })).toBe("Epoch 14 · done — Bundle −70%");
  });
});
