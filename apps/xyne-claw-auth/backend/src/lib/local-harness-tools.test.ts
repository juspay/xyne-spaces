import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalHarnessRun } from "@prisma/client";

vi.mock("../config.js", () => ({
  CONFIG: {
    internalUrl: "http://auth.local",
    xyneClawUrl: "http://claw.local",
    xyneClawS2sKey: "s2s",
    localHarnessRunTimeoutMs: 600000,
    localHarnessEnabled: true,
  },
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));

vi.mock("../db.js", () => ({ prisma: { user: { findUnique: vi.fn(async () => null) } } }));

vi.mock("../redis.js", () => ({
  redisService: { getConnection: () => ({ get: vi.fn(async () => null), set: vi.fn(async () => "OK"), del: vi.fn(async () => 1) }) },
}));

vi.mock("./session-tokens.js", () => ({ mintSessionToken: vi.fn(() => "token") }));

vi.mock("../repositories/localHarnessRepository.js", () => ({
  authenticatedProviders: vi.fn(() => ["codex-cli"]),
  localHarnessRepository: {
    setPendingAction: vi.fn(async () => true),
    enqueueRun: vi.fn(async () => ({ id: "run-2" })),
  },
}));

vi.mock("../repositories/index.js", () => ({
  agentRepository: { findBySlug: vi.fn(async () => ({ config: { tools: { custom: [] } } })) },
}));

function makeRun(localSandbox: Record<string, unknown> | undefined): LocalHarnessRun {
  return {
    id: "run-1",
    sessionId: "sess-1",
    userId: "user-1",
    orgId: "org-1",
    agentSlug: "assistant",
    provider: "codex-cli",
    model: null,
    pendingActionId: null,
    envelope: localSandbox ? { localSandbox } : {},
  } as unknown as LocalHarnessRun;
}

const CONTAINER_TOOLS = [
  "container-run",
  "container-run-detached",
  "container-poll-job",
  "container-write-file",
  "container-read-file",
  "container-edit-file",
];

describe("listToolsForRun container tools", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { servers: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  it("lists the container tools for a container run", async () => {
    const { listToolsForRun } = await import("./local-harness.js");
    const specs = await listToolsForRun(makeRun({ command: "chat", instruction: "", skills: [], container: true }));
    const names = specs.map((s) => s.toolName);
    for (const slug of CONTAINER_TOOLS) expect(names).toContain(slug);
    expect(names).toContain("deliver-files");
    expect(names).toContain("page-open-file");
  });

  it("omits the container tools for a plain local sandbox run", async () => {
    const { listToolsForRun } = await import("./local-harness.js");
    const specs = await listToolsForRun(makeRun({ command: "chat", instruction: "", skills: [] }));
    const names = specs.map((s) => s.toolName);
    for (const slug of CONTAINER_TOOLS) expect(names).not.toContain(slug);
    expect(names).toContain("deliver-files");
  });

  it("omits both sandbox and container tools when no localSandbox is set", async () => {
    const { listToolsForRun } = await import("./local-harness.js");
    const specs = await listToolsForRun(makeRun(undefined));
    const names = specs.map((s) => s.toolName);
    for (const slug of CONTAINER_TOOLS) expect(names).not.toContain(slug);
    expect(names).not.toContain("deliver-files");
  });
});
