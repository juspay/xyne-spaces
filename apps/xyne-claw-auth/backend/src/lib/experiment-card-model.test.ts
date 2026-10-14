import { beforeAll, describe, expect, it } from "vitest";
import type { ExperimentEpoch, ExperimentFinding, ExperimentReview, ExperimentRun } from "@prisma/client";

process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

let model: typeof import("./experiment-card-model.js");
beforeAll(async () => {
  model = await import("./experiment-card-model.js");
});
const buildExperimentEpochCard: typeof model.buildExperimentEpochCard = (...args) => model.buildExperimentEpochCard(...args);
const buildExperimentStatusCard: typeof model.buildExperimentStatusCard = (...args) => model.buildExperimentStatusCard(...args);
const experimentCardStatus: typeof model.experimentCardStatus = (...args) => model.experimentCardStatus(...args);
const experimentExitRule: typeof model.experimentExitRule = (...args) => model.experimentExitRule(...args);
const experimentFailureText: typeof model.experimentFailureText = (...args) => model.experimentFailureText(...args);
const planItemsFrom: typeof model.planItemsFrom = (...args) => model.planItemsFrom(...args);
const splitMentionLines: typeof model.splitMentionLines = (...args) => model.splitMentionLines(...args);

const t0 = new Date("2026-10-07T02:29:00.000Z");
const hours = (n: number) => new Date(t0.getTime() + n * 3_600_000);

function run(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "run_1",
    conversationId: "conv_1",
    channelId: "ch_1",
    agentSlug: "architect",
    userId: "u_1",
    orgId: "org_1",
    focus: "dashboard & desktop quality\n(1) perf (2) workspace (3) electron",
    provider: "spaces",
    modelId: null,
    kind: "experiment",
    status: "running",
    epoch: 4,
    deadlineAt: hours(7),
    currentHypothesis: "Route-level splitting cuts the entry chunk",
    currentSessionId: "sess_4",
    lastEpochEndedAt: null,
    sandboxNote: null,
    deliveredArtifacts: [],
    checkerSessionIds: [],
    finalReport: null,
    statusMessageId: null,
    createdAt: t0,
    updatedAt: hours(3),
    ...overrides,
  };
}

function finding(id: string, status: string, epoch: number, at: number, extra: Partial<ExperimentFinding> = {}): ExperimentFinding {
  return {
    id,
    experimentId: "run_1",
    epoch,
    status,
    title: `Finding ${id}`,
    hypothesis: "h",
    note: null,
    proofArtifactPath: null,
    createdAt: hours(at),
    updatedAt: hours(at),
    ...extra,
  };
}

function epochRow(sessionId: string, epoch: number, status: string, extra: Partial<ExperimentEpoch> = {}): ExperimentEpoch {
  return {
    id: `e_${sessionId}`,
    experimentId: "run_1",
    epoch,
    sessionId,
    messageId: null,
    status,
    hypothesis: null,
    plan: null,
    previewUrl: null,
    codeUrl: null,
    terminalUrl: null,
    retries: 0,
    error: null,
    summary: null,
    attachmentNames: [],
    needsYou: [],
    startedAt: hours(epoch),
    endedAt: null,
    updatedAt: hours(epoch),
    ...extra,
  };
}

const review = (findingId: string, epoch: number, verdict: string): ExperimentReview => ({
  id: `r_${findingId}_${epoch}`,
  experimentId: "run_1",
  findingId,
  epoch,
  verdict,
  reason: "r",
  duplicateOf: null,
  createdAt: hours(epoch),
});

describe("experimentExitRule", () => {
  it("states the real exit rule for each kind", () => {
    expect(experimentExitRule("experiment", 7 * 3_600_000)).toBe("Time-boxed: runs for the full 7h.");
    expect(experimentExitRule(null, 3_600_000)).toBe("Time-boxed: runs for the full 1h.");
    expect(experimentExitRule("framework", 7 * 3_600_000)).toBe("Ends when every candidate is closed, or after 7h at most.");
    expect(experimentExitRule("understanding", 2 * 3_600_000)).toBe("Ends when every open code path is closed, or after 2h at most.");
    expect(experimentExitRule("repo-history", 7 * 3_600_000)).toBe("Ends when the commit walk reaches HEAD.");
  });
});

describe("experimentCardStatus", () => {
  it("maps run statuses to card statuses", () => {
    expect(experimentCardStatus("running")).toBe("running");
    expect(experimentCardStatus("finishing")).toBe("finishing");
    expect(experimentCardStatus("done")).toBe("done");
    expect(experimentCardStatus("aborted")).toBe("stopped");
  });
});

describe("buildExperimentStatusCard", () => {
  const findings = [
    finding("a", "proved", 1, 1, { proofArtifactPath: "/tmp/out/area1-bundle.md" }),
    finding("b", "refuted", 2, 2),
    finding("c", "conjecture", 3, 3),
  ];
  const epochs = [
    epochRow("sess_1", 1, "done"),
    epochRow("sess_2", 2, "failed"),
    epochRow("sess_3", 3, "done", { needsYou: ["@Sithaarth please review PR #2726"] }),
    epochRow("sess_4", 4, "running", { previewUrl: "https://x/claw-preview/s4/" }),
  ];

  it("summarises counts, epochs, the newest findings and the live links", () => {
    const card = buildExperimentStatusCard({ run: run(), findings, reviews: [review("a", 2, "contradicts")], epochs, now: hours(3) });
    expect(card.title).toBe("dashboard & desktop quality");
    expect(card.model).toBe("spaces (default)");
    expect(card.counts).toEqual({ proved: 1, refuted: 1, open: 1 });
    expect(card.epochs).toEqual({ completed: 2, failed: 1 });
    expect(card.findings.map((row) => row.title)).toEqual(["Finding c", "Finding b", "Finding a"]);
    expect(card.findings[2]).toEqual({ title: "Finding a", status: "proved", epoch: 1, proof: "area1-bundle.md", verdict: "contradicts" });
    expect(card.needsYou).toEqual(["@Sithaarth please review PR #2726"]);
    expect(card.links).toEqual({ preview: "https://x/claw-preview/s4/" });
    expect(card.hypothesis).toBe("Route-level splitting cuts the entry chunk");
    expect(card).not.toHaveProperty("endedAt");
  });

  it("drops live-only fields and shows the report once the run ends", () => {
    const card = buildExperimentStatusCard({
      run: run({ status: "done", finalReport: "All three areas covered.", lastEpochEndedAt: hours(7) }),
      findings,
      reviews: [],
      epochs,
    });
    expect(card.status).toBe("done");
    expect(card.endedAt).toBe(hours(7).toISOString());
    expect(card.report).toBe("All three areas covered.");
    expect(card).not.toHaveProperty("links");
    expect(card).not.toHaveProperty("hypothesis");
  });

  it("falls back to the agent default model and a generic title", () => {
    const card = buildExperimentStatusCard({ run: run({ provider: null, focus: null }), findings: [], reviews: [], epochs: [] });
    expect(card.model).toBe("agent default");
    expect(card.title).toBe("Autonomous experiment");
    expect(card).not.toHaveProperty("focus");
  });
});

describe("buildExperimentEpochCard", () => {
  it("shows only a hypothesis recorded during the epoch, never the run's latest", () => {
    const card = buildExperimentEpochCard({ run: run(), epoch: epochRow("sess_4", 4, "running"), findings: [], reviews: [] });
    expect(card).not.toHaveProperty("hypothesis");
  });

  it("shows the live hypothesis, plan, links and this epoch's findings while running", () => {
    const card = buildExperimentEpochCard({
      run: run(),
      epoch: epochRow("sess_4", 4, "running", {
        hypothesis: "Route-level splitting cuts the entry chunk",
        plan: [{ id: "1", title: "Measure", status: "completed" }, { id: "2", title: "Split", status: "in_progress" }],
        previewUrl: "https://x/p/",
        codeUrl: "https://x/c/",
      }),
      findings: [finding("a", "proved", 4, 4), finding("b", "proved", 3, 3)],
      reviews: [],
    });
    expect(card.hypothesis).toBe("Route-level splitting cuts the entry chunk");
    expect(card.plan).toEqual([{ id: "1", title: "Measure", status: "completed" }, { id: "2", title: "Split", status: "in_progress" }]);
    expect(card.links).toEqual({ preview: "https://x/p/", code: "https://x/c/" });
    expect(card.findings.map((row) => row.title)).toEqual(["Finding a"]);
  });

  it("keeps its own hypothesis and drops links once finished", () => {
    const card = buildExperimentEpochCard({
      run: run({ currentSessionId: "sess_5" }),
      epoch: epochRow("sess_4", 4, "done", { hypothesis: "Old idea", previewUrl: "https://x/p/", summary: "Done.", endedAt: hours(5) }),
      findings: [],
      reviews: [],
    });
    expect(card.hypothesis).toBe("Old idea");
    expect(card).not.toHaveProperty("links");
    expect(card.summary).toBe("Done.");
    expect(card.endedAt).toBe(hours(5).toISOString());
  });
});

describe("planItemsFrom", () => {
  it("keeps well-formed rows and defaults unknown statuses to pending", () => {
    expect(planItemsFrom([{ id: "1", title: "A", status: "weird" }, { id: "", title: "B" }, null, "x"])).toEqual([
      { id: "1", title: "A", status: "pending" },
    ]);
    expect(planItemsFrom(null)).toEqual([]);
  });
});

describe("splitMentionLines", () => {
  it("pulls the lines that mention someone and plain-texts the body", () => {
    const span = '<span data-mention="" data-mention-type="user" data-user-id="u9" data-username="Sithaarth" class="chat-input-mention">@Sithaarth</span>';
    const { body, mentionLines } = splitMentionLines(`Epoch done.\n\n${span} please review PR #2726.\nOther line.`);
    expect(mentionLines).toEqual([`${span} please review PR #2726.`]);
    expect(body).toBe("Epoch done.\n\n@Sithaarth please review PR #2726.\nOther line.");
  });

  it("returns no mention lines when nobody is mentioned", () => {
    expect(splitMentionLines("plain").mentionLines).toEqual([]);
  });
});

describe("experimentFailureText", () => {
  it("describes provider capacity, quota and other failures without leaking raw errors", () => {
    expect(experimentFailureText({ emptyReason: "provider_capacity", emptyReasonDetail: "model stopped responding for 135s" }))
      .toBe("The AI provider had a temporary problem — model stopped responding for 135s.");
    expect(experimentFailureText({ error: "HTTP 429 Too Many Requests" })).toBe("The provider is out of quota or rate-limited.");
    expect(experimentFailureText({ error: "TypeError: x is undefined at /srv/app.js:10" })).toBe("The epoch stopped with an internal error.");
  });
});
