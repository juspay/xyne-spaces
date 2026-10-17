import { beforeEach, describe, expect, it, vi } from "vitest";

const xorMock = vi.fn();
vi.mock("../src/xor.js", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), xor: (req: unknown) => xorMock(req) }));

const { buildXorDecideTool, prepareItems } = await import("../src/xor-decide-tool.js");
const { buildSubagentTools } = await import("../src/subagent-tools.js");
const { getAllCustomTools } = await import("xyne-claw-shared");
type Spec = import("../src/subagent-tools.js").CustomSubagentSpec;

const meta = { userId: "u1", conversationId: "c1", agentSlug: "a" };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  xorMock.mockReset();
});

describe("prepareItems", () => {
  it("accepts text, data-URL images and sandbox image paths", async () => {
    const read = vi.fn(async (p: string) => (p === "/tmp/a.png" ? PNG : null));
    const r = await prepareItems([{ id: "t", text: "hello" }, { id: "i", image: PNG }, { id: "p", imagePath: "/tmp/a.png" }], meta, read);
    expect("items" in r && r.items).toEqual([{ id: "t", text: "hello" }, { id: "i", image: PNG }, { id: "p", image: PNG }]);
  });

  it.each([
    [[], /non-empty/],
    [[{ id: "a" }], /needs text, image or imagePath/],
    [[{ id: "a", image: "https://x/y.png" }], /base64 data URL/],
    [[{ id: "a", imagePath: "/tmp/missing.png" }], /could not read image/],
    [[{ id: "a", text: "x" }, { id: "a", text: "y" }], /unique id/],
    [Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, text: "x" })), /at most 200/],
  ])("rejects %#", async (raw, msg) => {
    const r = await prepareItems(raw, meta, async () => null);
    expect("error" in r && r.error).toMatch(msg);
  });
});

describe("xor-decide tool", () => {
  const exec = async (params: unknown) =>
    (await (buildXorDecideTool(meta).execute as (...a: unknown[]) => Promise<{ content: Array<{ text: string }>; details: { result?: { items: unknown[] } } }>)("c", params));

  it("validates questions before calling xor", async () => {
    expect((await exec({ items: [{ id: "a", text: "x" }], questions: [{ id: "q", question: "?", type: "maybe" }] })).content[0]!.text).toMatch(/type must be/);
    expect(xorMock).not.toHaveBeenCalled();
  });

  it("classifies every item and returns a summary, a table and the JSON in details", async () => {
    xorMock.mockImplementation(async (req: { state: string }) => ({
      failure: { type: "noul", noul: req.state.includes("ERROR") ? 0.97 : 0.04 },
      component: { type: "choice", choice: req.state.includes("db") ? "db" : "api", confidence: 0.9 },
    }));
    const out = await exec({
      context: "Log lines.",
      items: [{ id: "l1", text: "ERROR db refused" }, { id: "l2", text: "INFO ok" }],
      questions: [
        { id: "failure", question: "Real failure?", type: "yesno" },
        { id: "component", question: "Component?", type: "choice", options: { api: "API", db: "DB" } },
      ],
    });
    expect(xorMock).toHaveBeenCalledTimes(2);
    expect(xorMock.mock.calls[0]![0]).toMatchObject({ state: "Log lines.\n\nERROR db refused", purpose: "xor-decide" });
    const t = out.content[0]!.text;
    expect(t).toContain("xor-decide: 2 item(s) × 2 question(s)");
    expect(t).toContain("- failure (yesno): answered 2, unsure 0 true=1, false=1");
    expect(t).toContain("| l1 | true (0.94) | db (0.9) |");
    expect(out.details.result?.items).toHaveLength(2);
  });

  it("is tagged so the parent never loads it in-process", () => {
    const tool = buildXorDecideTool(meta) as unknown as { name: string; slug: string; source: string };
    expect(tool).toMatchObject({ name: "xor-decide", slug: "xor-decide", source: "custom:xor" });
    expect(getAllCustomTools().find((t) => t.slug === "xor-decide")?.source).toBe("custom:xor");
  });
});

describe("custom subagents with xor-decide", () => {
  const spec = (tools: Spec["tools"]): Spec => ({ name: "log-triage", description: "Triage log lines", progressLabels: [], systemPrompt: "Classify.", paramName: "request", paramDescription: "", tools, skills: [] });

  it("builds a subagent whose only tool is xor-decide, as the cheap path, without exposing it to the parent", () => {
    const xorTool = buildXorDecideTool(meta);
    const built = buildSubagentTools([], [], undefined, undefined, undefined, undefined, undefined, [spec({ custom: ["xor-decide"] })], undefined, [xorTool]);
    const sub = built.subagentTools.find((t) => t.name === "log-triage");
    expect(sub).toBeDefined();
    expect(String(sub!.description)).toMatch(/^\[Subagent — runs on a cheap model; delegate this work instead of doing it yourself\]/);
    expect([...built.directTools, ...built.remainingCustomTools].map((t) => t.name)).not.toContain("xor-decide");
  });

  it("skips a subagent that names xor-decide when the runtime did not provide it", () => {
    const built = buildSubagentTools([], [], undefined, undefined, undefined, undefined, undefined, [spec({ custom: ["xor-decide"] })]);
    expect(built.subagentTools.find((t) => t.name === "log-triage")).toBeUndefined();
  });
});
