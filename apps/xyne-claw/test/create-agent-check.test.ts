import { test, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  process.env["XYNE_CLAW_S2S_KEY"] = "test-key";
});

import {
  checkCreateAgent,
  createAgentDroppedToolsNote,
  createAgentRefusedText,
  createAgentUnknownToolsText,
} from "../src/create-agent-check.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockCheck(response: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("returns the server's refusal for a taken name", async () => {
  const fetchMock = mockCheck({
    ok: true,
    json: async () => ({ known: true, error: "An agent called **Cricket Scores** already exists here.", notGranted: [] }),
  });

  expect(await checkCreateAgent("u1", { name: "Cricket Scores" })).toEqual({
    refusal: "An agent called **Cricket Scores** already exists here.",
    notGranted: [],
  });
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/internal/agent-create/check");
});

test("reports tools that do not exist", async () => {
  mockCheck({
    ok: true,
    json: async () => ({ known: true, error: null, notGranted: ["sandbox-run-command", 7, ""] }),
  });

  expect(await checkCreateAgent("u1", { name: "Web Scraper" })).toEqual({
    refusal: null,
    notGranted: ["sandbox-run-command"],
  });
});

test("fails open when the check is unavailable", async () => {
  const pass = { refusal: null, notGranted: [] };
  mockCheck({ ok: false, json: async () => ({}) });
  expect(await checkCreateAgent("u1", { name: "Weather" })).toEqual(pass);

  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
  expect(await checkCreateAgent("u1", { name: "Weather" })).toEqual(pass);

  expect(await checkCreateAgent("", { name: "Weather" })).toEqual(pass);
});

test("tells the model plainly that no card is coming", () => {
  const text = createAgentRefusedText("An agent called **X** already exists here.");

  expect(text).toContain("NOT queued");
  expect(text).toContain("no draft card will appear");
  expect(text).toContain("Do not say a card is on screen");
});

test("sends the model back to fix unknown tool names", () => {
  const text = createAgentUnknownToolsText(["sandbox-run-command", "sandbox-create-session"]);

  expect(text).toContain("NOT queued");
  expect(text).toContain("`sandbox-run-command`, `sandbox-create-session`");
  expect(text).toContain("Call create-agent again");
});

test("warns about tools still dropped after the retry", () => {
  expect(createAgentDroppedToolsNote(["page-read2"])).toContain("will NOT be granted: `page-read2`");
});
