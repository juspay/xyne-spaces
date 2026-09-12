import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import type { ExperimentFinding, ExperimentReview, ExperimentRun } from "@prisma/client";

// experiment.js has side-effectful imports (config, logger, repositories) that
// expect an encryption key present; mirror experiment-kinds.test.ts.
process.env["ENCRYPTION_KEY"] ??= "00".repeat(32);

const mocks = vi.hoisted(() => ({
  findBySlug: vi.fn(),
  listFindings: vi.fn(),
  listReviews: vi.fn(),
  spacesAppFetch: vi.fn(),
  decryptStoredField: vi.fn(),
}));

// Override only the two repos the notice path touches; keep every other export
// so unrelated importers of repositories/index.js are unaffected.
vi.mock("../repositories/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repositories/index.js")>();
  return {
    ...actual,
    agentRepository: { findBySlug: mocks.findBySlug },
    experimentRepository: {
      listFindings: mocks.listFindings,
      listReviews: mocks.listReviews,
    },
  };
});

vi.mock("../surfaces/spaces/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../surfaces/spaces/client.js")>();
  return {
    ...actual,
    spacesAppFetch: mocks.spacesAppFetch,
    decryptStoredField: mocks.decryptStoredField,
  };
});

let postExperimentNotice: typeof import("./experiment.js")["postExperimentNotice"];
let buildLedgerMarkdown: typeof import("./experiment.js")["buildLedgerMarkdown"];
beforeAll(async () => {
  ({ postExperimentNotice, buildLedgerMarkdown } = await import("./experiment.js"));
});

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "run_123",
    orgId: "org_1",
    agentSlug: "test-agent",
    channelId: "chan_1",
    conversationId: "conv_1",
    epoch: 3,
    deadlineAt: new Date("2026-09-02T00:00:00.000Z"),
    focus: "apps/backend",
    status: "completed",
    provider: null,
    modelId: null,
    finalReport: null,
    ...overrides,
  } as unknown as ExperimentRun;
}

const findings: ExperimentFinding[] = [
  {
    id: "f1",
    experimentId: "run_123",
    epoch: 2,
    status: "proved",
    title: "A real bug",
    hypothesis: "It reproduces under X",
    note: "confirmed",
    proofArtifactPath: "proof.html",
  } as unknown as ExperimentFinding,
];

const reviews: ExperimentReview[] = [
  {
    findingId: "f1",
    verdict: "contradicts",
    epoch: 3,
    reason: "could not reproduce",
  } as unknown as ExperimentReview,
];

describe("postExperimentNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptStoredField.mockReturnValue("decrypted-token");
    mocks.spacesAppFetch.mockResolvedValue(undefined);
    mocks.listFindings.mockResolvedValue(findings);
    mocks.listReviews.mockResolvedValue(reviews);
  });

  it("posts the deterministic ledger built from the run's persisted findings/reviews", async () => {
    const run = makeRun();
    mocks.findBySlug.mockResolvedValue({
      spacesAppToken: "encrypted",
      spacesAppUserId: "appuser_1",
    });

    await postExperimentNotice(run);

    // Fetches the CORRECT run id — guards against a regression that reads
    // findings/reviews for the wrong run.
    expect(mocks.findBySlug).toHaveBeenCalledWith(run.agentSlug, run.orgId);
    expect(mocks.listFindings).toHaveBeenCalledWith(run.id);
    expect(mocks.listReviews).toHaveBeenCalledWith(run.id);

    expect(mocks.spacesAppFetch).toHaveBeenCalledTimes(1);
    const [endpoint, payload, token] = mocks.spacesAppFetch.mock.calls[0]! as [
      string,
      { markdownText: string; channelId: string; conversationId: string; userId: string; metadata: unknown },
      string,
    ];
    expect(endpoint).toBe("/chat/postMessage");
    expect(token).toBe("decrypted-token");
    expect(payload).toMatchObject({
      channelId: run.channelId,
      conversationId: run.conversationId,
      userId: "appuser_1",
      metadata: { contentFormat: "markdown" },
    });
    // The exact deterministic payload the reviewer asked to be pinned.
    expect(payload.markdownText).toBe(
      `**/experiment ended**\n\n${buildLedgerMarkdown(run, findings, reviews)}`,
    );
  });

  it("no-ops when the run has no orgId", async () => {
    await postExperimentNotice(makeRun({ orgId: null }));
    expect(mocks.findBySlug).not.toHaveBeenCalled();
    expect(mocks.listFindings).not.toHaveBeenCalled();
    expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
  });

  it("no-ops when the agent has no Spaces app identity", async () => {
    mocks.findBySlug.mockResolvedValue({ spacesAppToken: null, spacesAppUserId: null });
    await postExperimentNotice(makeRun());
    expect(mocks.listFindings).not.toHaveBeenCalled();
    expect(mocks.spacesAppFetch).not.toHaveBeenCalled();
  });
});