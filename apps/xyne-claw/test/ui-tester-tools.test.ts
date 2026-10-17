import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, Buffer>();
const run = vi.fn();
let session: unknown = undefined;
const xorMock = vi.fn();

vi.mock("xyne-claw-shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildSandboxStoreKey: (u?: string, c?: string, a?: string) => (u && c ? `${c}_${a}` : undefined),
  sandboxConversationIdFromMeta: (m?: Record<string, string>) => m?.["conversationId"],
  getSandboxSession: (key: string) => (key === "conv-1_architect" ? session : undefined),
}));
vi.mock("../src/xor.js", () => ({ xor: (req: unknown) => xorMock(req) }));

const { buildUiTesterTools, UI_TESTER_SOURCE } = await import("../src/ui-tester/tools.js");

const meta = { userId: "u1", conversationId: "conv-1", agentSlug: "architect" };
const fakeSession = {
  commands: { run },
  files: {
    write: async (p: string, b: Buffer) => void files.set(p, b),
    read: async (p: string) => {
      const b = files.get(p);
      if (!b) throw new Error(`missing ${p}`);
      return b;
    },
  },
};

const tool = (name: string) => buildUiTesterTools(meta).find((t) => t.name === name)!;
const exec = async (name: string, params: unknown) => {
  const out = await (tool(name).execute as (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }>)("call-1", params);
  return out.content[0]!.text;
};
const spec = { baseUrl: "http://localhost:5199/claw", variations: [{ id: "typical", path: "/v3/runs" }, { id: "mobile", path: "/v3/runs", viewport: { width: 390, height: 844 } }] };

beforeEach(() => {
  files.clear();
  run.mockReset();
  xorMock.mockReset();
  session = fakeSession;
});

describe("ui-tester tools", () => {
  it("are tagged for the ui-tester subagent", () => {
    for (const t of buildUiTesterTools(meta)) expect((t as unknown as { source: string }).source).toBe(UI_TESTER_SOURCE);
  });

  it("validates the spec before touching the sandbox", async () => {
    expect(await exec("ui-test-variations", {})).toMatch(/spec. must be an object/);
    expect(await exec("ui-test-variations", { spec: { variations: [] } })).toMatch(/baseUrl is required/);
    expect(await exec("ui-test-variations", { spec: { baseUrl: "x", variations: [{ id: "a b" }] } })).toMatch(/unique id/);
    expect(await exec("ui-test-variations", { spec: { baseUrl: "x", variations: [{ id: "a" }, { id: "a" }] } })).toMatch(/unique id/);
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a spec sent as a JSON string, rejects invalid JSON", async () => {
    session = undefined;
    expect(await exec("ui-test-variations", { spec: JSON.stringify(spec) })).toMatch(/no sandbox session/);
    expect(await exec("ui-test-variations", { spec: "{not json" })).toMatch(/not valid JSON/);
  });

  it("asks for a sandbox when the conversation has none", async () => {
    session = undefined;
    expect(await exec("ui-test-variations", { spec })).toMatch(/no sandbox session/);
  });

  it("writes the harness, runs it, checks each screenshot and reports", async () => {
    run.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("mkdir")) return { stdout: "", stderr: "", exitCode: 0 };
      const out = "/tmp/ui-tester/runs-page/out";
      files.set(`${out}/typical.png`, Buffer.from("png-1"));
      files.set(`${out}/mobile.png`, Buffer.from("png-2"));
      files.set(`${out}/summary.json`, Buffer.from(JSON.stringify({ results: [
        { id: "typical", screenshot: `${out}/typical.png`, audit: { offRight: [], garbage: [], duplicateToasts: [] }, consoleErrors: [], pageErrors: [], unmatchedRequests: [] },
        { id: "mobile", screenshot: `${out}/mobile.png`, audit: { viewportWidth: 390, offRight: ["Dashboard"], garbage: [], duplicateToasts: [] }, consoleErrors: [], pageErrors: [], unmatchedRequests: [] },
      ] })));
      return { stdout: `noise\n${JSON.stringify({ ok: true, outDir: out })}\n`, stderr: "", exitCode: 0 };
    });
    xorMock.mockResolvedValue({ cut_off: { type: "choice", choice: "no", confidence: 0.9 } });
    const report = await exec("ui-test-variations", { spec, runName: "runs page" });
    expect(files.has("/tmp/ui-tester/runs-page/harness.cjs")).toBe(true);
    expect(files.has("/tmp/ui-tester/runs-page/audit.js")).toBe(true);
    expect(JSON.parse(files.get("/tmp/ui-tester/runs-page/spec.json")!.toString()).outDir).toBe("/tmp/ui-tester/runs-page/out");
    expect(run.mock.calls[1]![0]).toContain("node harness.cjs spec.json");
    expect(xorMock).toHaveBeenCalledTimes(2);
    expect(xorMock.mock.calls[0]![0]).toMatchObject({ purpose: "ui-tester", images: ["data:image/png;base64," + Buffer.from("png-1").toString("base64")] });
    expect(report).toContain("2 checked — 1 fail, 0 unsure, 1 pass");
    expect(report).toContain("- FAIL mobile");
    expect(JSON.parse(files.get("/tmp/ui-tester/runs-page/out/verdicts.json")!.toString())).toHaveLength(2);
  });

  it("delivers videos and failing screenshots through the parent's deliver tool", async () => {
    run.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("mkdir")) return { stdout: "", stderr: "", exitCode: 0 };
      const out = "/tmp/ui-tester/vid/out";
      files.set(`${out}/a.png`, Buffer.from("png-a"));
      files.set(`${out}/b.png`, Buffer.from("png-b"));
      files.set(`${out}/summary.json`, Buffer.from(JSON.stringify({ results: [
        { id: "a", title: "Footer page 1", screenshot: `${out}/a.png`, video: `${out}/a.webm`, audit: {}, textChecks: [{ text: "Page 1 of 3", kind: "expect", ok: true }] },
        { id: "b", screenshot: `${out}/b.png`, video: `${out}/b.webm`, audit: {}, textChecks: [{ text: "Page 3 of 3", kind: "expect", ok: false }] },
      ] })));
      return { stdout: JSON.stringify({ ok: true }), stderr: "", exitCode: 0 };
    });
    xorMock.mockResolvedValue({ cut_off: { type: "choice", choice: "no", confidence: 0.9 } });
    const deliverExec = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Delivered 3 files" }] });
    const tools = buildUiTesterTools(meta, { deliver: { name: "sandbox-deliver-files", execute: deliverExec } as never });
    (fakeSession as unknown as { id: string }).id = "sbx-1";
    const report = (await (tools[0]!.execute as (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }>)("c", { spec: { ...spec, video: true }, runName: "vid" })).content[0]!.text;
    expect(deliverExec).toHaveBeenCalledTimes(1);
    expect(deliverExec.mock.calls[0]![1]).toEqual({ sessionId: "sbx-1", paths: ["/tmp/ui-tester/vid/out/a.webm", "/tmp/ui-tester/vid/out/b.webm", "/tmp/ui-tester/vid/out/b.png"] });
    expect(report).toContain("Delivered 3 file(s) to the thread: a.webm, b.webm, b.png");
    expect(report).toContain('expected text not on the page: "Page 3 of 3"');
    expect(report).toContain('- PASS a "Footer page 1"');
  });

  it("resolves a non-sandbox sourceDir to the same directory inside the sandbox", async () => {
    run.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("mkdir")) return { stdout: "", exitCode: 0 };
      if (cmd.startsWith("test -d")) return { stdout: "no\n", exitCode: 0 };
      if (cmd.startsWith("find /")) return { stdout: "/home/user/repo/apps/xyne-claw-auth/frontend/src\n", exitCode: 0 };
      if (cmd.includes("endpoints.cjs")) return { stdout: JSON.stringify({ "/api/x": { found: false }, __themeKeys: ["xyne-theme"] }), exitCode: 0 };
      const out = "/tmp/ui-tester/src/out";
      files.set(`${out}/summary.json`, Buffer.from(JSON.stringify({ results: [{ id: "probe", audit: {}, unmatchedRequests: ["GET /api/x"] }] })));
      return { stdout: JSON.stringify({ ok: true }), exitCode: 0 };
    });
    const report = await exec("ui-test-variations", { spec: { ...spec, sourceDir: "/app/xyne-claw/data/workspaces/s1/apps/xyne-claw-auth/frontend/src" }, runName: "src", visual: false });
    expect(report).toContain("used /home/user/repo/apps/xyne-claw-auth/frontend/src");
    expect(report).toContain("Theme storage keys found in the source (set spec.themeStorageKey): xyne-theme");
    expect(run.mock.calls.some(([c]: [string]) => c.includes("endpoints.cjs") && c.includes("/home/user/repo/apps/xyne-claw-auth/frontend/src"))).toBe(true);
  });

  it("surfaces a harness failure instead of a report", async () => {
    run.mockImplementation(async (cmd: string) =>
      cmd.startsWith("mkdir") ? { stdout: "", exitCode: 0 } : { stdout: JSON.stringify({ ok: false, error: "playwright is not installed" }), stderr: "", exitCode: 2 });
    expect(await exec("ui-test-variations", { spec })).toMatch(/harness failed \(exit 2\)\. playwright is not installed/);
    expect(xorMock).not.toHaveBeenCalled();
  });

  it("visual-check answers custom questions about saved screenshots", async () => {
    files.set("/tmp/a.png", Buffer.from("png"));
    xorMock.mockResolvedValue({ custom_save: { type: "choice", choice: "yes", confidence: 0.93 } });
    const out = await exec("visual-check", { screenshots: ["/tmp/a.png"], checks: [{ id: "save", question: "Is Save greyed out?", options: { yes: "Greyed", no: "Enabled" }, expect: "yes" }] });
    expect(out).toContain("1 checked — 0 fail, 0 unsure, 1 pass");
    expect(out).toContain("custom_save=yes(0.93)");
    expect(Object.keys(xorMock.mock.calls[0]![0].questions)).toContain("custom_save");
  });
});
