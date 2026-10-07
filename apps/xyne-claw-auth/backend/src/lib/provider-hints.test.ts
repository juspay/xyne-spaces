import { test, expect } from "vitest";
import {
  normalizeProviderName,
  normalizeProviderOrder,
  stripAddressedAgentMention,
} from "./provider-hints.js";

test("provider names users actually say are normalized to supported keys", () => {
  expect(normalizeProviderOrder(["anthropic"])).toEqual({ providers: ["claude"], unknown: [] });
  expect(normalizeProviderOrder(["openai"])).toEqual({ providers: ["codex"], unknown: [] });
  expect(normalizeProviderOrder(["ChatGPT"])).toEqual({ providers: ["codex"], unknown: [] });
  expect(normalizeProviderOrder(["claude"])).toEqual({ providers: ["claude"], unknown: [] });
});

test("order is kept and duplicates collapse", () => {
  expect(normalizeProviderOrder(["anthropic", "openai", "claude"])).toEqual({
    providers: ["claude", "codex"],
    unknown: [],
  });
});

test("providers Xyne does not offer are reported, never silently kept", () => {
  expect(normalizeProviderOrder(["gemini", "anthropic"])).toEqual({
    providers: ["claude"],
    unknown: ["gemini"],
  });
  expect(normalizeProviderOrder(["totally-made-up"])).toEqual({
    providers: [],
    unknown: ["totally-made-up"],
  });
});

test("a single name resolves through its aliases, case-insensitively", () => {
  expect(normalizeProviderName("Anthropic")).toBe("claude");
  expect(normalizeProviderName("  chatgpt ")).toBe("codex");
  expect(normalizeProviderName("open router")).toBe("openrouter");
  expect(normalizeProviderName("spaces")).toBe("spaces");
});

test("an alias resolves only as a whole token, never as a substring", () => {
  expect(normalizeProviderName("gpt")).toBe("codex");
  expect(normalizeProviderName("summarise this gpt output")).toBeNull();
});

test("a name we do not carry resolves to nothing rather than a guess", () => {
  expect(normalizeProviderName("gemini")).toBeNull();
  expect(normalizeProviderName("")).toBeNull();
});

test("the addressed agent's mention is stripped, other text is left alone", () => {
  expect(stripAddressedAgentMention("@newton-doctor what model are you using?", "newton-doctor")).toBe(
    "what model are you using?",
  );
  expect(stripAddressedAgentMention("what model are you using?", "newton-doctor")).toBe(
    "what model are you using?",
  );
});
