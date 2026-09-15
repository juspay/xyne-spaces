import { describe, it, expect, beforeAll } from "vitest";
import type { ExperimentRun } from "@prisma/client";

// buildEpochTask lives in experiment.ts, which pulls in config (required env).
process.env["ENCRYPTION_KEY"] ||= "00".repeat(32);

let buildEpochTask: typeof import("./experiment.js")["buildEpochTask"];
beforeAll(async () => {
  ({ buildEpochTask } = await import("./experiment.js"));
});

function run(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "exp-1",
    epoch: 7,
    deadlineAt: new Date(Date.now() + 60 * 60_000),
    status: "running",
    focus: "explain the tables",
    sandboxNote: null,
    deliveredArtifacts: [],
    kind: "understanding",
    ...overrides,
  } as ExperimentRun;
}

describe("buildEpochTask — recovery from a recycled sandbox", () => {
  it("surfaces already-delivered artifacts so a fresh sandbox rehydrates by name", () => {
    const task = buildEpochTask(
      run({ deliveredArtifacts: ["tables-explained.html", "scope.csv"] }),
      "## ledger",
    );
    expect(task).toContain("ALREADY DELIVERED");
    expect(task).toContain("tables-explained.html");
    expect(task).toContain("spaces-fetch-attachment");
    expect(task).toContain("fetch it and extend it");
  });

  it("omits the delivered line entirely when nothing has been delivered yet", () => {
    const task = buildEpochTask(run({ deliveredArtifacts: [] }), "## ledger");
    expect(task).not.toContain("ALREADY DELIVERED");
  });

  it("caps the echoed list so a long run cannot crowd out the ledger", () => {
    const many = Array.from({ length: 100 }, (_, i) => `f${i}.json`);
    const task = buildEpochTask(run({ deliveredArtifacts: many }), "## ledger");
    // Only the last 40 are echoed; the earliest are dropped from the prompt.
    expect(task).toContain("f99.json");
    expect(task).not.toContain("f0.json,");
    expect(task).toContain("## ledger");
  });
});
