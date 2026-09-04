import { test, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  process.env["XYNE_CLAW_S2S_KEY"] = "test-key";
});

import {
  buildSuggestConnectorsTool,
  type SuggestConnectorsRef,
} from "../src/suggest-connectors.js";

async function callTool(ref: SuggestConnectorsRef, params: unknown, userId?: string) {
  const tool = buildSuggestConnectorsTool(ref, userId);
  return (
    tool as unknown as {
      execute: (
        id: string,
        p: unknown,
      ) => Promise<{ content: { text: string }[]; details?: Record<string, unknown> }>;
    }
  ).execute("tc-1", params);
}

function mockAvailability(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("tells the model when a connector is already connected", async () => {
  mockAvailability({ success: true, connected: ["github"], known: true });

  const ref: SuggestConnectorsRef = {};
  const out = await callTool(ref, { serverTypes: ["github"] }, "user-1");

  expect(ref.value).toEqual({ serverTypes: ["github"] });
  expect(out.content[0]?.text).toContain("ALREADY CONNECTED");
  expect(out.content[0]?.text).not.toContain("each card carries a Connect button");
  expect(out.details?.["connected"]).toEqual(["github"]);
});

test("promises a Connect button only when the lookup says nothing is connected", async () => {
  mockAvailability({ success: true, connected: [], known: true });

  const out = await callTool({}, { serverTypes: ["figma"] }, "user-1");

  expect(out.content[0]?.text).toContain("each card carries a Connect button");
  expect(out.content[0]?.text).not.toContain("ALREADY CONNECTED");
});

test("stays silent about state when the lookup is unavailable", async () => {
  mockAvailability({}, false);

  const ref: SuggestConnectorsRef = {};
  const out = await callTool(ref, { serverTypes: ["notion"] }, "user-1");

  expect(ref.value).toEqual({ serverTypes: ["notion"] });
  expect(out.content[0]?.text).not.toContain("ALREADY CONNECTED");
  expect(out.content[0]?.text).not.toContain("Connect button");
  expect(out.details?.["connected"]).toBeUndefined();
});

test("still queues the card when the lookup throws", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("connection refused");
    }),
  );

  const ref: SuggestConnectorsRef = {};
  const out = await callTool(ref, { serverTypes: ["slack"] }, "user-1");

  expect(ref.value).toEqual({ serverTypes: ["slack"] });
  expect(out.content[0]?.text).toContain("Connector cards for slack");
});

test("skips the lookup entirely when no userId is wired through", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  const ref: SuggestConnectorsRef = {};
  await callTool(ref, { serverTypes: ["github"] });

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(ref.value).toEqual({ serverTypes: ["github"] });
});
