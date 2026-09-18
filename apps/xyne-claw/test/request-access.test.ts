import { describe, it, expect } from "vitest";
import { buildRequestAccessTool, type RequestAccessRef } from "../src/request-access.js";

type ToolLike = { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> };
const run = async (ref: RequestAccessRef, params: unknown): Promise<string> => {
  const tool = buildRequestAccessTool(ref) as unknown as ToolLike;
  const out = await tool.execute("call-1", params);
  return out.content[0]?.text ?? "";
};

describe("request-access", () => {
  it("raises a structured blocker for a login wall that returned 200", async () => {
    const ref: RequestAccessRef = {};
    const text = await run(ref, {
      url: "https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/branches",
      reason: "listing branches — got a login page instead",
    });

    expect(ref.value).toMatchObject({
      serverType: "webfetch-host:bitbucket.juspay.net",
      host: "bitbucket.juspay.net",
      reason: "unknown_host",
      source: "agent",
      reason_text: "listing branches — got a login page instead",
    });
    expect(text.startsWith("STOP —")).toBe(true);
    expect(text).toMatch(/Do NOT call any more tools/);
  });

  // The bug this guards: writing `{ type: "text", text }` inside a helper named
  // `text` serialises the FUNCTION, so the model receives an empty content block
  // and never learns it was blocked.
  it("returns non-empty text on every path", async () => {
    for (const params of [
      { url: "https://internal.example.com/x", reason: "r" },
      { url: "not-a-url", reason: "r" },
      { url: "ftp://x.example.com", reason: "r" },
      { url: "", reason: "r" },
      { url: "https://accounts.google.com/signin", reason: "r" },
    ]) {
      const text = await run({}, params);
      expect(text.length, JSON.stringify(params)).toBeGreaterThan(20);
      expect(JSON.parse(JSON.stringify({ text })).text, "must survive serialisation").toBe(text);
    }
  });

  it("refuses identity providers — a card naming one is a phishing primitive", async () => {
    for (const host of ["accounts.google.com", "login.microsoftonline.com", "appleid.apple.com"]) {
      const ref: RequestAccessRef = {};
      const text = await run(ref, { url: `https://${host}/signin`, reason: "x" });
      expect(ref.value, host).toBeUndefined();
      expect(text, host).toMatch(/cannot be requested/);
    }
  });

  it("refuses our own surfaces", async () => {
    const ref: RequestAccessRef = {};
    await run(ref, { url: "https://app.xyne.ai/thing", reason: "x" });
    expect(ref.value).toBeUndefined();
  });

  it("keeps the first request and counts repeats", async () => {
    const ref: RequestAccessRef = {};
    await run(ref, { url: "https://a.example.com/1", reason: "first" });
    await run(ref, { url: "https://b.example.com/2", reason: "second" });
    expect(ref.value?.host).toBe("a.example.com");
    expect(ref.duplicates).toBe(1);
  });

  it("rejects a non-http scheme without raising a blocker", async () => {
    const ref: RequestAccessRef = {};
    const text = await run(ref, { url: "file:///etc/passwd", reason: "x" });
    expect(ref.value).toBeUndefined();
    expect(text).toMatch(/must be http/);
  });
});
