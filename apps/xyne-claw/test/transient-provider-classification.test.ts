import { test, expect } from "vitest";
import {
  isTransientProviderError,
  ProviderStallError,
  ProviderTerminalError,
} from "../src/agent.js";

// The exact OpenAI/Codex 5xx body that dead-ended euler-doctor on 2026-08-18:
// the SDK exhausted its own auto-retries and surfaced this instead of throwing,
// so the run must treat it as a fallback-eligible transient error.
const CODEX_SERVER_ERROR =
  'Codex error: {"type":"error","error":{"type":"server_error","code":"server_error","message":"An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID abc in your message.","param":null},"sequence_number":2}';

test("ProviderTerminalError is transient (falls back)", () => {
  expect(isTransientProviderError(new ProviderTerminalError("codex", "server_error"))).toBe(true);
});

test("ProviderStallError stays transient", () => {
  expect(isTransientProviderError(new ProviderStallError("spaces", 120000))).toBe(true);
});

test("Codex server_error 5xx body is transient", () => {
  expect(isTransientProviderError(new Error(CODEX_SERVER_ERROR))).toBe(true);
});

test("bare server_error / 500 / internal server error are transient", () => {
  expect(isTransientProviderError(new Error("server_error"))).toBe(true);
  expect(isTransientProviderError(new Error("upstream returned 500"))).toBe(true);
  expect(isTransientProviderError(new Error("Internal Server Error"))).toBe(true);
});

test("existing 5xx gateway signals remain transient", () => {
  expect(isTransientProviderError(new Error("502 Bad Gateway"))).toBe(true);
  expect(isTransientProviderError(new Error("503 service unavailable"))).toBe(true);
  expect(isTransientProviderError(new Error("504 gateway timeout"))).toBe(true);
  expect(isTransientProviderError(new Error("model overloaded"))).toBe(true);
});

test("non-transient errors are NOT misclassified", () => {
  // A 4xx / validation / logic error must hard-fail, not walk the fallback chain.
  expect(isTransientProviderError(new Error("400 bad request"))).toBe(false);
  expect(isTransientProviderError(new Error("invalid_api_key"))).toBe(false);
  expect(isTransientProviderError(new Error("tool arguments failed schema validation"))).toBe(false);
  expect(isTransientProviderError(undefined)).toBe(false);
  expect(isTransientProviderError(null)).toBe(false);
});
