import { test, expect } from "vitest";
import {
  providerTypesFromText,
  providersUserAskedFor,
  unsupportedProvidersFromText,
  wantsProviderRoster,
} from "./provider-hints.js";

test("roster asks resolve without the model", () => {
  expect(wantsProviderRoster("list down all the AI providers i have")).toBe(true);
  expect(wantsProviderRoster("what AI providers do we have")).toBe(true);
  expect(wantsProviderRoster("how many models do i have")).toBe(true);
  expect(wantsProviderRoster("show me the models")).toBe(true);
  expect(wantsProviderRoster("i want to connect to an AI provider")).toBe(true);
});

test("naming a provider is a request for that one, not the roster", () => {
  expect(wantsProviderRoster("help me connect to Anthropic")).toBe(false);
  expect(wantsProviderRoster("connect me to codex")).toBe(false);
});

test("ordinary tasks never look like a provider ask", () => {
  expect(wantsProviderRoster("summarize this doc")).toBe(false);
  expect(wantsProviderRoster("what is the weather")).toBe(false);
  expect(providersUserAskedFor("summarize this doc")).toEqual([]);
});

test("users are matched on the names they actually type", () => {
  expect(providersUserAskedFor("help me connect to Anthropic")).toEqual(["claude"]);
  expect(providersUserAskedFor("i want to use openai")).toEqual(["codex"]);
  expect(providersUserAskedFor("switch to chatgpt")).toEqual(["codex"]);
  expect(providersUserAskedFor("connect github copilot")).toEqual(["copilot"]);
  expect(providerTypesFromText("set up litellm")).toEqual(["litellm"]);
});

test("providers we do not offer are named back, never silently dropped", () => {
  expect(unsupportedProvidersFromText("connect me to gemini")).toEqual(["Gemini"]);
  expect(unsupportedProvidersFromText("can i use mistral")).toEqual(["Mistral"]);
  expect(unsupportedProvidersFromText("add deepseek")).toEqual(["DeepSeek"]);
  expect(unsupportedProvidersFromText("connect claude")).toEqual([]);
});

test("a question about an agent's config is not a request to connect", () => {
  // Both posted a card in prod (2026-09-10) and read as noise: the user was
  // asking about an agent, not about their own accounts.
  expect(wantsProviderRoster("which AI provider this agent will use check")).toBe(false);
  expect(wantsProviderRoster("can u check which AI provider the above PR agent will use")).toBe(false);
  expect(providersUserAskedFor("create a PR agent for me with anthropic as Ai provider")).toEqual([]);
  expect(wantsProviderRoster("then why in the model->provider it shows spaces platform model")).toBe(
    false,
  );
});

test("an unsupported name does not turn into a roster", () => {
  expect(wantsProviderRoster("i want to connect the gemini model")).toBe(false);
});
