#!/usr/bin/env node
/**
 * Verify that the configured LLM endpoint actually answers.
 *
 * Run it directly (`pnpm run doctor:llm`) to check what is on disk, or import
 * pingModel() to check values before they are written.
 *
 * The check is a real one-token chat completion, not a /models list and not a
 * /health probe. A gateway can list models and still reject chat, and "the
 * gateway is up" is a different question from "these credentials can complete
 * with this model" — anything less can pass here and still fail on the first
 * real request, which is the failure this whole script exists to prevent.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const BACKEND_ENV = "apps/backend/.env.local";
const CLAW_ENV = "apps/xyne-claw/.env";

const TIMEOUT_MS = Number(process.env.LLM_PING_TIMEOUT_MS ?? 15000);

/** Pull the human-readable bit out of an OpenAI-shaped error body. */
function errorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.message;
    if (message) return String(message).slice(0, 300);
  } catch {
    // Not JSON — usually a proxy or login page answering instead of the gateway.
  }
  return body.trim().slice(0, 300) || "(empty response body)";
}

/**
 * Ping the endpoint and return { ok, title, detail, hint }.
 *
 * The verdicts are grouped by what the reader has to go and fix — URL, key, or
 * model — rather than by retry semantics. That is why 429 is a pass: it proves
 * the URL resolved, the key was accepted, and the model exists. The request the
 * user makes a minute later will work.
 */
export async function pingModel(baseUrl, apiKey, model) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let response;
  let body;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    const reason =
      error?.name === "TimeoutError"
        ? `no answer within ${TIMEOUT_MS / 1000}s`
        : (error?.cause?.code ?? error?.message ?? "connection failed");
    return {
      ok: false,
      title: "Could not reach the endpoint",
      detail: `POST ${url} — ${reason}`,
      hint: "Check the base URL, and that the gateway is running and reachable from this machine.",
    };
  }

  if (response.status === 429) {
    return {
      ok: true,
      title: "Credentials work — the provider is rate limiting right now",
      detail: errorMessage(body),
      hint: "",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      title: `Endpoint rejected the API key (${response.status})`,
      detail: errorMessage(body),
      hint: "The URL is right and something answered — the key is wrong, expired, or not allowed to use this model.",
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      title: "Nothing at that path (404)",
      detail: `POST ${url} — ${errorMessage(body)}`,
      hint: `Most OpenAI-compatible gateways want the base URL to end in /v1 — try ${baseUrl.replace(/\/+$/, "")}/v1. A model name the gateway does not serve can also 404.`,
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      title: `Endpoint returned ${response.status}`,
      detail: errorMessage(body),
      hint: "That is the provider's side rather than your config. Worth retrying before changing anything.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      title: `Endpoint returned ${response.status}`,
      detail: errorMessage(body),
      hint: `Check that "${model}" is a model this endpoint serves.`,
    };
  }

  // A 200 is not proof on its own: some gateways answer 200 with an error
  // payload, and the apps need `choices` specifically.
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      title: "Endpoint answered, but not with JSON",
      detail: body.trim().slice(0, 300),
      hint: "Something is answering that URL, but it is not a model gateway — check for a proxy or login page in front of it.",
    };
  }
  if (!Array.isArray(parsed?.choices) || parsed.choices.length === 0) {
    return {
      ok: false,
      title: "Endpoint answered 200, but with no completion",
      detail: errorMessage(body),
      hint: `The gateway took the request and returned no choices — usually a model name ("${model}") it does not actually serve.`,
    };
  }

  return { ok: true, title: `${model} answered`, detail: "", hint: "" };
}

/** Print a result the same way whether it came from setup or from the CLI. */
export function reportPing(result) {
  console.log(`\n ${result.ok ? "✓" : "✗"} ${result.title}`);
  if (result.detail) console.log(`   ${result.detail}`);
  if (result.hint) console.log(`   ${result.hint}`);
  if (!result.ok) console.log("   More: docs/setup/ai-providers.md");
}

// ---------------------------------------------------------------------------
// Standalone run
// ---------------------------------------------------------------------------

/** Read the current value of KEY from an env file, ignoring commented lines. */
function readEnvValue(relPath, key) {
  const file = join(repoRoot, relPath);
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .reverse() // last assignment wins, same as dotenv
    .find((l) => l.trimStart().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
}

/** Placeholders shipped in .env.example that should be treated as "unset". */
function isPlaceholder(value) {
  if (!value) return true;
  return (
    value.startsWith("your-") ||
    value.startsWith("set-me") ||
    value.includes("example.com") ||
    value.includes("example.net")
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = readEnvValue(BACKEND_ENV, "LITELLM_BASE_URL") || readEnvValue(CLAW_ENV, "LITELLM_URL");
  const apiKey = readEnvValue(BACKEND_ENV, "LITELLM_API_KEY") || readEnvValue(CLAW_ENV, "LITELLM_API_KEY");
  const model = readEnvValue(BACKEND_ENV, "LITELLM_BEST_MODEL") || readEnvValue(CLAW_ENV, "LITELLM_MODEL");

  if (isPlaceholder(baseUrl) || isPlaceholder(apiKey)) {
    console.log("\n No AI credentials configured yet.");
    console.log(" Run `pnpm run env:setup` to add them, or see docs/setup/ai-providers.md");
    process.exit(1);
  }
  if (!model) {
    console.log("\n A base URL and key are set, but no model is.");
    console.log(` Set LITELLM_BEST_MODEL in ${BACKEND_ENV}, or re-run \`pnpm run env:setup\`.`);
    process.exit(1);
  }

  console.log(`\n Pinging ${baseUrl} with ${model} ...`);
  const result = await pingModel(baseUrl, apiKey, model);
  reportPing(result);
  process.exit(result.ok ? 0 : 1);
}
