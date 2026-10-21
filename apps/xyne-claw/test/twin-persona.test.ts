import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTwinPersonaBlock, fetchAgentPromptFiles, formatTwinPersona } from "../src/twin-persona.js";

afterEach(() => vi.unstubAllGlobals());

const stubFiles = (files: unknown[]) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { files } })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("formatTwinPersona", () => {
  it("no files → empty block", () => {
    expect(formatTwinPersona([])).toBe("");
  });

  it("header, then each file trimmed and joined by a blank line", () => {
    expect(
      formatTwinPersona([
        { name: "soul.md", content: "\n  I write short, direct replies.  \n\n" },
        { name: "people.md", content: "Asha: my manager." },
      ]),
    ).toBe(
      [
        "# Speaking as you",
        "This is your persona — who you are and how you sound — drawn from the user's own",
        "approved memory files. Speak AS this person by default; you do not need to call any",
        "tool to use what's below. Prefer this voice over generic phrasing.",
        "",
        "=== soul.md ===\nI write short, direct replies.\n\n=== people.md ===\nAsha: my manager.",
      ].join("\n"),
    );
  });
});

describe("fetchAgentPromptFiles", () => {
  it("skips malformed entries individually and keeps only well-typed optional fields, in order", async () => {
    stubFiles([
      null,
      { name: "a", content: "x", loadInPrompt: true, description: "d" },
      { name: 1, content: "y" },
      { name: "b", content: "z", loadInPrompt: "yes" },
    ]);
    const files = await fetchAgentPromptFiles("digital-twin", "u1");
    expect(files).toEqual([
      { name: "a", content: "x", loadInPrompt: true, description: "d" },
      { name: "b", content: "z" },
    ]);
    expect(Object.keys(files[0]!)).toEqual(["name", "content", "loadInPrompt", "description"]);
  });

  it("asks for candidates only when told to", async () => {
    const fetchMock = stubFiles([]);
    await fetchAgentPromptFiles("digital-twin", "u1", { candidates: true });
    await fetchAgentPromptFiles("digital-twin", "u1");
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toContain("/claw/api/v1/memory/agent-prompt-files?agentSlug=digital-twin&userId=u1&candidates=1");
    expect(urls[1]).toMatch(/agent-prompt-files\?agentSlug=digital-twin&userId=u1$/);
  });

  it("degrades to [] on a failed request or without a user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await fetchAgentPromptFiles("digital-twin", "u1")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("boom"))));
    expect(await fetchAgentPromptFiles("digital-twin", "u1")).toEqual([]);
    const fetchMock = stubFiles([{ name: "a", content: "x" }]);
    expect(await fetchAgentPromptFiles("digital-twin", "")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildTwinPersonaBlock", () => {
  const FLAG = "XYNE_OPT_JEV_MEMORY_FILE_PICK";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[FLAG];
    process.env[FLAG] = "0";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  });

  it("file pick off → the fetched files, formatted", async () => {
    stubFiles([{ name: "soul.md", content: " voice " }]);
    expect(await buildTwinPersonaBlock("digital-twin", "u1", "hi")).toBe(
      formatTwinPersona([{ name: "soul.md", content: " voice " }]),
    );
  });

  it("no files → empty block", async () => {
    stubFiles([]);
    expect(await buildTwinPersonaBlock("digital-twin", "u1", "hi")).toBe("");
  });
});
