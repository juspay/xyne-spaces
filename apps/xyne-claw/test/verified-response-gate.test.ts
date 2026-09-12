import { test, expect, vi, beforeEach } from "vitest";

// Mock the LLM verifier so Gate 2 never makes a network call. Gate 1 (the
// deterministic required-tools check) runs BEFORE the verifier, so the
// missing-tools path never reaches this mock — we assert exactly that.
const verifyResponseMock = vi.fn(async () => ({ ok: true, errors: [] as unknown[] }));
vi.mock("../src/verify-response.js", () => ({
  verifyResponse: (...args: unknown[]) => verifyResponseMock(...args),
  renderRejection: (errors: unknown[]) => JSON.stringify({ delivered: false, errors }),
}));
vi.mock("../src/metrics.js", () => ({ metric: { count: () => {} } }));

import { buildVerifiedResponseTool, type EvidenceRef } from "../src/verified-response.js";
import type { PendingResponse } from "xyne-claw-shared";

function makeTool(requiredTools: string[], toolsUsed: string[]) {
  const pending: PendingResponse[] = [];
  const evidenceRef: EvidenceRef = { getDigest: () => "", toolsUsed: () => toolsUsed };
  const tool = buildVerifiedResponseTool({
    getPendingResponses: () => pending,
    abortRun: () => {},
    task: "do the thing",
    evidenceRef,
    agentSlug: "rcaagent",
    requiredTools,
  });
  return { tool, pending, evidenceRef };
}

async function run(tool: { execute: (id: string, p: unknown) => Promise<{ content: { text: string }[] }> }, message: string) {
  const res = await tool.execute("call-1", { message });
  return res.content[0]!.text;
}

beforeEach(() => {
  verifyResponseMock.mockClear();
  verifyResponseMock.mockResolvedValue({ ok: true, errors: [] });
});

test("deterministic gate BLOCKS delivery when a required tool was not called", async () => {
  const { tool, pending } = makeTool(["rca-critic"], ["rca-investigator"]);
  const out = await run(tool, "here is my verdict");
  const parsed = JSON.parse(out);

  expect(parsed.delivered).toBe(false);
  expect(parsed.errors[0].check).toBe("required-tool-not-called");
  expect(out).toContain("rca-critic");
  // Nothing delivered, and the LLM verifier was never reached.
  expect(pending).toHaveLength(0);
  expect(verifyResponseMock).not.toHaveBeenCalled();
});

test("gate PASSES to the verifier once the required tool actually ran", async () => {
  const toolsUsed: string[] = [];
  const pending: PendingResponse[] = [];
  const evidenceRef: EvidenceRef = { getDigest: () => "", toolsUsed: () => toolsUsed };
  const tool = buildVerifiedResponseTool({
    getPendingResponses: () => pending,
    abortRun: () => {},
    task: "do the thing",
    evidenceRef,
    agentSlug: "rcaagent",
    requiredTools: ["rca-critic"],
  });

  // Round 1: tool not yet called → blocked.
  const blocked = JSON.parse(await run(tool, "verdict v1"));
  expect(blocked.delivered).toBe(false);
  expect(pending).toHaveLength(0);

  // The critic actually runs now.
  toolsUsed.push("rca-critic");

  // Round 2: gate satisfied → verifier (mocked ok) → delivered.
  const delivered = await run(tool, "verdict v2");
  expect(delivered).toContain("STOP");
  expect(verifyResponseMock).toHaveBeenCalledTimes(1);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.message).toBe("verdict v2");
});

test("substring + case-insensitive match (config 'critic' matches tool 'rca-critic')", async () => {
  const { tool, pending } = makeTool(["CRITIC"], ["rca-critic"]);
  await run(tool, "verdict");
  // Matched → passed to verifier → delivered.
  expect(verifyResponseMock).toHaveBeenCalledTimes(1);
  expect(pending).toHaveLength(1);
});

test("fails open after MAX_REJECTIONS so a non-compliant model cannot hang the run", async () => {
  const { tool, pending } = makeTool(["rca-critic"], []); // never called
  // Default RESPONSE_VERIFY_MAX_ROUNDS = 2 → two rejections then deliver as-is.
  expect(JSON.parse(await run(tool, "v1")).delivered).toBe(false);
  expect(JSON.parse(await run(tool, "v2")).delivered).toBe(false);
  const third = await run(tool, "v3");
  expect(third).toContain("STOP");
  expect(pending).toHaveLength(1);
  expect(pending[0]!.message).toBe("v3");
});

test("no requiredTools configured → gate is a no-op (existing behavior)", async () => {
  const { tool, pending } = makeTool([], []);
  await run(tool, "verdict");
  expect(verifyResponseMock).toHaveBeenCalledTimes(1);
  expect(pending).toHaveLength(1);
});
