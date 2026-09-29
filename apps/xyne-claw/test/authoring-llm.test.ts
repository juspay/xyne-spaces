import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthoringLlmError,
  chatJson,
  chatStream,
  parseLooseJson,
} from "../src/authoring/authoring-llm.js";

const encoder = new TextEncoder();

function streamOf(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const sse = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

afterEach(() => vi.unstubAllGlobals());

describe("parseLooseJson", () => {
  it("reads plain, fenced and prose-wrapped JSON", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(parseLooseJson("no json here")).toBeNull();
  });
});

describe("chatStream", () => {
  it("yields deltas even when an SSE line is split across reads, and stops at [DONE]", async () => {
    const line = sse("Hello, ");
    const cut = Math.floor(line.length / 2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([line.slice(0, cut), line.slice(cut) + sse("world"), "data: [DONE]\n\n", sse("ignored")]),
      ),
    );
    const parts: string[] = [];
    for await (const part of chatStream([{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 1000 })) {
      parts.push(part);
    }
    expect(parts.join("")).toBe("Hello, world");
  });

  it("ignores keepalive comments and malformed lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamOf([": keepalive\n\n", "data: {broken\n\n", sse("ok")])),
    );
    const parts: string[] = [];
    for await (const part of chatStream([{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 1000 })) {
      parts.push(part);
    }
    expect(parts).toEqual(["ok"]);
  });
});

describe("chatJson", () => {
  it("retries without the thinking params when the proxy rejects them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unknown param: reasoning_effort", { status: 400 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const out = await chatJson<{ ok: boolean }>([{ role: "user", content: "hi" }], {
      maxTokens: 10,
      timeoutMs: 1000,
    });
    expect(out).toEqual({ ok: true });
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(second["reasoning_effort"]).toBeUndefined();
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(first["reasoning_effort"]).toBe("none");
  });

  it("reports a parse error, an http error and a caller abort distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "not json" } }] })));
    await expect(
      chatJson([{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "parse" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(
      chatJson([{ role: "user", content: "hi" }], { maxTokens: 10, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });

    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
        return Response.json({});
      }),
    );
    const err = await chatJson([{ role: "user", content: "hi" }], {
      maxTokens: 10,
      timeoutMs: 1000,
      signal: abort.signal,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthoringLlmError);
    expect((err as AuthoringLlmError).kind).toBe("aborted");
  });
});
