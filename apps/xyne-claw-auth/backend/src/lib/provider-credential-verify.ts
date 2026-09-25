import { assertSafeOutboundUrl } from "../mcpgateway/services/http-client.js";
import { errMsg } from "./errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("provider-verify");

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const CODEX_CHATGPT_BACKEND = "https://chatgpt.com/backend-api";
const COPILOT_MODELS_URL = "https://api.githubcopilot.com/models";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";

const VERIFY_TIMEOUT_MS = 15_000;

export interface VerifiedModel {
  id: string;
  name: string;
}

export type ProviderVerification =
  | { ok: true; models: VerifiedModel[] }
  | { ok: false; kind: "rejected" | "unreachable"; message: string; status?: number };

export interface VerifyProviderInput {
  provider: string;
  apiKey: string;
  baseUrl?: string | null;
  authType?: string | null;
}

const KEYLESS_PROVIDERS = new Set(["spaces"]);

export function providerNeedsKey(provider: string): boolean {
  return !KEYLESS_PROVIDERS.has(provider);
}

const MAX_PROVIDER_MESSAGE = 160;

export function extractProviderMessage(body: string): string {
  const raw = body.trim();
  if (!raw) return "";

  let message = "";
  try {
    const parsed: unknown = JSON.parse(raw);
    message = findMessage(parsed, 0);
  } catch {
    message = raw;
  }

  const oneLine = (message || raw).replace(/\s+/g, " ").trim();
  if (!oneLine || oneLine.startsWith("{") || oneLine.startsWith("[")) return "";
  return oneLine.length > MAX_PROVIDER_MESSAGE
    ? `${oneLine.slice(0, MAX_PROVIDER_MESSAGE - 1).trimEnd()}…`
    : oneLine;
}

function findMessage(value: unknown, depth: number): string {
  if (typeof value === "string") return value;
  if (depth > 3 || typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error_description", "detail", "error"]) {
    const found = findMessage(record[key], depth + 1);
    if (found) return found;
  }
  return "";
}

const rejected = (status: number, body: string, provider: string): ProviderVerification => {
  const detail = extractProviderMessage(body);
  return {
    ok: false,
    kind: "rejected",
    status,
    message: detail
      ? `${providerLabel(provider)} rejected this key: ${detail}`
      : `${providerLabel(provider)} rejected this key (${status}).`,
  };
};

const unreachable = (provider: string, detail: string): ProviderVerification => ({
  ok: false,
  kind: "unreachable",
  message: `Could not reach ${providerLabel(provider)} to check the key (${detail}). Nothing was saved — try again.`,
});

function providerLabel(provider: string): string {
  switch (provider) {
    case "claude":
      return "Anthropic";
    case "codex":
      return "OpenAI";
    case "copilot":
      return "GitHub Copilot";
    case "openrouter":
      return "OpenRouter";
    case "orcarouter":
      return "OrcaRouter";
    case "litellm":
      return "the LiteLLM gateway";
    default:
      return provider;
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function classify(provider: string, status: number, body: string): ProviderVerification {
  if (status >= 400 && status < 500) return rejected(status, body, provider);
  return unreachable(provider, `HTTP ${status}`);
}

async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ payload: unknown } | ProviderVerification> {
  try {
    await assertSafeOutboundUrl(url);
  } catch {
    return { ok: false, kind: "rejected", message: "The base URL must be a public https endpoint." };
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return classify(provider, res.status, text);
    }
    return { payload: await res.json() };
  } catch (err) {
    return unreachable(provider, errMsg(err).slice(0, 120));
  }
}

function isVerification(value: unknown): value is ProviderVerification {
  return typeof value === "object" && value !== null && "ok" in value;
}

function decodeChatgptAccountId(jwt: string): string | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[1]) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId = auth?.["chatgpt_account_id"];
    return typeof accountId === "string" ? accountId : undefined;
  } catch {
    return undefined;
  }
}

const listOf = (payload: unknown, key: string): Array<Record<string, unknown>> => {
  const record = (payload ?? {}) as Record<string, unknown>;
  const rows = record[key];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
};

const str = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value : "";

function toModels(rows: Array<Record<string, unknown>>, idKey: string, nameKey: string): VerifiedModel[] {
  const models: VerifiedModel[] = [];
  for (const row of rows) {
    const id = str(row[idKey]);
    if (!id) continue;
    models.push({ id, name: str(row[nameKey]) || id });
  }
  return models;
}

async function verifyClaude(input: VerifyProviderInput): Promise<ProviderVerification> {
  const root = trimTrailingSlashes(input.baseUrl?.trim() || ANTHROPIC_BASE_URL);
  const isOauth = input.authType === "oauth_token";
  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
  if (isOauth) {
    headers["Authorization"] = `Bearer ${input.apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = input.apiKey;
  }

  const result = await getJson("claude", `${root}/v1/models`, headers);
  if (isVerification(result)) return result;
  return { ok: true, models: toModels(listOf(result.payload, "data"), "id", "display_name") };
}

async function verifyCodex(input: VerifyProviderInput): Promise<ProviderVerification> {
  const isOauth = input.authType === "oauth_token";
  const headers: Record<string, string> = { Authorization: `Bearer ${input.apiKey}` };
  let url: string;

  if (isOauth) {
    url = `${CODEX_CHATGPT_BACKEND}/codex/models?client_version=0.0.0`;
    headers["originator"] = "codex_cli_rs";
    headers["User-Agent"] = "codex_cli_rs/0.0.0 (xyne-claw-auth)";
    const accountId = decodeChatgptAccountId(input.apiKey);
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  } else {
    url = `${trimTrailingSlashes(input.baseUrl?.trim() || OPENAI_BASE_URL)}/models`;
    headers["User-Agent"] = "codex-cli";
  }

  const result = await getJson("codex", url, headers);
  if (isVerification(result)) return result;

  if (isOauth) {
    const rows = listOf(result.payload, "models").filter(
      (row) => row["visibility"] !== "hide" && row["visibility"] !== "none",
    );
    return { ok: true, models: toModels(rows, "slug", "display_name") };
  }

  const models = toModels(listOf(result.payload, "data"), "id", "id").filter((model) =>
    /^(gpt-|o\d|chatgpt-)/i.test(model.id),
  );
  return { ok: true, models };
}

async function verifyCopilot(input: VerifyProviderInput): Promise<ProviderVerification> {
  const result = await getJson("copilot", COPILOT_MODELS_URL, {
    Authorization: `Bearer ${input.apiKey}`,
    "User-Agent": "opencode/0.3.118",
    "Openai-Intent": "conversation-edits",
    "Editor-Version": "vscode/1.95.0",
    "Copilot-Integration-Id": "vscode-chat",
  });
  if (isVerification(result)) return result;
  const rows = listOf(result.payload, "data").filter((row) => {
    const capabilities = row["capabilities"] as Record<string, unknown> | undefined;
    return capabilities?.["type"] === "chat" && row["model_picker_enabled"] !== false;
  });
  return { ok: true, models: toModels(rows, "id", "name") };
}

async function verifyOpenAiCompatible(
  provider: string,
  input: VerifyProviderInput,
  fallbackBase: string,
): Promise<ProviderVerification> {
  const root = trimTrailingSlashes(input.baseUrl?.trim() || fallbackBase);
  const result = await getJson(provider, `${root}/models`, {
    Authorization: `Bearer ${input.apiKey}`,
    "User-Agent": "xyne-claw-auth",
  });
  if (isVerification(result)) return result;
  return { ok: true, models: toModels(listOf(result.payload, "data"), "id", "id") };
}

export async function verifyProviderCredential(
  input: VerifyProviderInput,
  litellmFallbackBase: string,
): Promise<ProviderVerification> {
  if (!providerNeedsKey(input.provider)) return { ok: true, models: [] };
  if (!input.apiKey.trim()) {
    return { ok: false, kind: "rejected", message: "An API key is required." };
  }

  const verification = await runVerification(input, litellmFallbackBase);
  log.info(
    `[verify] provider=${input.provider} authType=${input.authType ?? "api_key"} → ${
      verification.ok ? `ok (${verification.models.length} models)` : `${verification.kind}${verification.status ? ` ${verification.status}` : ""}`
    }`,
  );
  return verification;
}

function runVerification(
  input: VerifyProviderInput,
  litellmFallbackBase: string,
): Promise<ProviderVerification> {
  switch (input.provider) {
    case "claude":
      return verifyClaude(input);
    case "codex":
      return verifyCodex(input);
    case "copilot":
      return verifyCopilot(input);
    case "openrouter":
      return verifyOpenAiCompatible("openrouter", input, OPENROUTER_BASE_URL);
    case "orcarouter":
      return verifyOpenAiCompatible("orcarouter", input, ORCAROUTER_BASE_URL);
    case "litellm":
      return verifyOpenAiCompatible("litellm", input, litellmFallbackBase);
    default:
      return Promise.resolve({
        ok: false,
        kind: "rejected",
        message: `Unknown provider "${input.provider}".`,
      });
  }
}

export function modelServedBy(models: VerifiedModel[], model: string | null | undefined): boolean {
  const wanted = model?.trim();
  if (!wanted || models.length === 0) return true;
  return models.some((candidate) => candidate.id === wanted);
}
