import { describe, expect, it, vi, beforeEach } from "vitest";
import JSZip from "jszip";

const interact = vi.fn();
const spacesFetchBuffer = vi.fn();
vi.mock("../mcp/servers/xyne-spaces-client.js", () => ({
  interact: (...a: unknown[]) => interact(...a),
  spacesFetchBuffer: (...a: unknown[]) => spacesFetchBuffer(...a),
}));

const { buildExperimentProofBundle } = await import("./experiment-bundle.js");

const AUTH = { token: "t", workspaceId: "w", baseUrl: "https://spaces.test" };

const run = {
  id: "exp1",
  agentSlug: "xyne-spaces-architect",
} as Parameters<typeof buildExperimentProofBundle>[0]["run"];

function finding(over: Partial<{ id: string; epoch: number; title: string; proofArtifactPath: string | null }>) {
  return {
    id: over.id ?? "f1",
    epoch: over.epoch ?? 1,
    title: over.title ?? "A finding",
    proofArtifactPath: over.proofArtifactPath === undefined ? "/workspace/proof_a.cjs" : over.proofArtifactPath,
  } as Parameters<typeof buildExperimentProofBundle>[0]["findings"][number];
}

/** interact() is called three times, in order:
 *   1. messageAttachment by conversationId  (denormalised path)
 *   2. message by conversationId            (to collect messageIds)
 *   3. messageAttachment by entityId in [..] (message-hop path)
 *  Both attachment queries return the same rows here; the impl dedupes by id. */
function mockThread(attachments: Array<{ id: string; originalFilename: string; size?: number }>) {
  const rows = attachments.map((a) => ({
    id: a.id,
    originalFilename: a.originalFilename,
    mimetype: "text/plain",
    size: a.size ?? 100,
    entityId: "m0",
  }));
  interact.mockReset();
  interact
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(attachments.map((_, i) => ({ messageId: `m${i}` })))
    .mockResolvedValueOnce(rows);
  spacesFetchBuffer.mockReset();
  spacesFetchBuffer.mockImplementation((path: string) =>
    Promise.resolve({ buffer: Buffer.from(`bytes-for-${path}`), contentType: "text/plain" }),
  );
}

async function pathsOf(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).sort();
}

describe("buildExperimentProofBundle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("matches an in-sandbox proof path to its delivered attachment, filed under its epoch", async () => {
    mockThread([{ id: "a1", originalFilename: "proof_a.cjs" }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({ epoch: 3, proofArtifactPath: "/workspace/proof_a.cjs" })],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    expect(bundle).not.toBeNull();
    expect(await pathsOf(bundle!.buffer)).toContain("epoch-03/proof_a.cjs");
    expect(bundle!.includedCount).toBe(1);
  });

  it("flags a finding whose proof never reached the thread — the live failure mode", async () => {
    mockThread([{ id: "a1", originalFilename: "something_else.cjs" }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({ proofArtifactPath: "/workspace/proof_dm_race.cjs" })],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    expect(bundle!.includedCount).toBe(0);
    expect(bundle!.entries[0]!.status).toBe("not-delivered");
    const zip = await JSZip.loadAsync(bundle!.buffer);
    const manifest = await zip.file("MANIFEST.md")!.async("string");
    expect(manifest).toContain("NOT IN BUNDLE");
  });

  it("still ships an undelivered-by-name attachment under unmatched/", async () => {
    mockThread([{ id: "a1", originalFilename: "orphan_report.html" }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({ proofArtifactPath: null })],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    expect(await pathsOf(bundle!.buffer)).toContain("unmatched/orphan_report.html");
    expect(bundle!.entries[0]!.status).toBe("no-proof-path");
  });

  it("keeps same-named proofs from different epochs apart", async () => {
    mockThread([{ id: "a1", originalFilename: "proof.cjs" }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [
        finding({ id: "f1", epoch: 1, proofArtifactPath: "proof.cjs" }),
        finding({ id: "f2", epoch: 2, proofArtifactPath: "proof.cjs" }),
      ],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    const paths = await pathsOf(bundle!.buffer);
    expect(paths).toContain("epoch-01/proof.cjs");
    expect(paths).toContain("epoch-02/proof.cjs");
  });

  it("skips an oversized attachment instead of failing the bundle", async () => {
    mockThread([{ id: "a1", originalFilename: "huge.bin", size: 999 * 1024 * 1024 }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({ proofArtifactPath: "huge.bin" })],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    expect(bundle!.entries[0]!.status).toBe("too-large");
    expect(spacesFetchBuffer).not.toHaveBeenCalled();
  });

  it("returns null when the thread has no attachments at all", async () => {
    interact.mockReset();
    interact.mockResolvedValue([]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({})],
      findingsMarkdown: "# findings",
      conversationId: "c1",
      auth: AUTH,
    });
    expect(bundle).toBeNull();
  });

  it("always includes findings.md and MANIFEST.md", async () => {
    mockThread([{ id: "a1", originalFilename: "proof_a.cjs" }]);
    const bundle = await buildExperimentProofBundle({
      run,
      findings: [finding({})],
      findingsMarkdown: "# the ledger",
      conversationId: "c1",
      auth: AUTH,
    });
    const zip = await JSZip.loadAsync(bundle!.buffer);
    expect(await zip.file("findings.md")!.async("string")).toBe("# the ledger");
    expect(zip.file("MANIFEST.md")).toBeTruthy();
  });
});
