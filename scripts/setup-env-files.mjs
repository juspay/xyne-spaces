#!/usr/bin/env node
/**
 * Copy each app's .env.example to the filename that app actually reads, then
 * optionally collect AI provider credentials and write them into those files.
 *
 * Never overwrites an existing env file, so it is safe to re-run against a working
 * tree. Called by `pnpm run bootstrap` before secret generation, which needs
 * apps/backend/.env.local to exist.
 *
 * start-services.sh also creates three of these on demand; the dashboard's is created
 * nowhere else, and doing it here keeps the whole step visible in one place rather than
 * as a side effect of starting containers.
 *
 * The AI prompt is skipped automatically when stdin is not a terminal (CI), and can
 * be skipped explicitly with SKIP_AI_SETUP=1.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pingModel, reportPing } from "./ping-llm.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The backend and dashboard read `.env.local` (via `dotenv -e .env.local`), while
// xyne-claw and claw-auth read `.env` (via `tsx --env-file=.env`). This asymmetry is
// deliberate — copy to the filename shown, not a uniform one.
const ENV_FILES = [
  ["apps/backend/.env.example", "apps/backend/.env.local"],
  ["apps/dashboard/.env.example", "apps/dashboard/.env.local"],
  ["apps/xyne-claw/.env.example", "apps/xyne-claw/.env"],
  ["apps/xyne-claw-auth/backend/.env.example", "apps/xyne-claw-auth/backend/.env"],
];

const BACKEND_ENV = "apps/backend/.env.local";
const CLAW_ENV = "apps/xyne-claw/.env";

// ---------------------------------------------------------------------------
// Copy the env files
// ---------------------------------------------------------------------------

let created = 0;
let missing = 0;

for (const [example, target] of ENV_FILES) {
  const examplePath = join(repoRoot, example);
  const targetPath = join(repoRoot, target);

  if (existsSync(targetPath)) {
    console.log(`Kept ${target} (already exists)`);
    continue;
  }
  if (!existsSync(examplePath)) {
    console.warn(`Skipped ${target} — ${example} not found`);
    missing++;
    continue;
  }

  copyFileSync(examplePath, targetPath);
  console.log(`Created ${target}`);
  created++;
}

console.log(`\n${created} env file(s) created, ${ENV_FILES.length - created - missing} already present.`);

// ---------------------------------------------------------------------------
// AI provider setup
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

/**
 * Set KEY=value in an env file: replaces every existing assignment, or appends
 * the key if it was never there. Other lines, comments, and ordering are left alone.
 */
function upsertEnvValue(relPath, key, value) {
  const file = join(repoRoot, relPath);
  if (!existsSync(file)) return false;

  const lines = readFileSync(file, "utf8").split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (line.trimStart().startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`# Added by pnpm run env:setup`);
    next.push(`${key}=${value}`);
  }

  writeFileSync(file, next.join("\n"));
  return true;
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

/**
 * Ask for one value, pre-filling the line editor with the current or default one
 * so it can be edited in place rather than retyped. Enter accepts what is shown.
 */
async function ask(rl, label, current) {
  const prefill = isPlaceholder(current) ? "" : current;
  const promise = rl.question(`   ${label}: `);
  if (prefill) rl.write(prefill); // editable: arrow keys, backspace all work
  const answer = (await promise).trim();
  return answer;
}

/**
 * Ask for a credential without echoing it.
 *
 * readline writes each keystroke to the interface's output stream, so muting that
 * stream for the duration of the answer hides the typing. The prompt is written
 * before muting so the label still shows.
 */
async function askSecret(rl, label, current) {
  const hasExisting = !isPlaceholder(current);
  const state = hasExisting ? "hidden — Enter keeps the current one" : "hidden";
  stdout.write(`   ${label} (${state}): `);

  const realWrite = stdout.write.bind(stdout);
  stdout.write = () => true;
  let answer;
  try {
    answer = (await rl.question("")).trim();
  } finally {
    stdout.write = realWrite;
    stdout.write("\n");
  }

  if (!answer) return hasExisting ? current : "";
  return answer;
}

/**
 * A key that is a stray keystroke is worse than no key: it overwrites a working
 * value and fails later with a confusing 401. Re-ask instead of accepting it.
 */
async function askApiKey(rl, current) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = await askSecret(rl, "API key", current);
    if (!key) return "";
    if (key.length < 8) {
      console.log(`   ⚠️  That is only ${key.length} character${key.length === 1 ? "" : "s"} — API keys are longer. Try again.`);
      continue;
    }
    if (/\s/.test(key)) {
      console.log("   ⚠️  That contains whitespace. Paste the key on its own. Try again.");
      continue;
    }
    return key;
  }
  console.log("   Giving up on the API key after three attempts.");
  return "";
}

/** Show enough of a key to recognise it, never the whole thing. */
function maskKey(key) {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}${"*".repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
}

async function configureAi() {
  if (process.env.SKIP_AI_SETUP === "1") {
    console.log("\n⏭  SKIP_AI_SETUP=1 — leaving AI settings untouched.");
    return;
  }
  if (!stdin.isTTY) {
    console.log("\n⏭  Non-interactive shell — leaving AI settings untouched.");
    console.log("   Configure them later: docs/setup/ai-providers.md");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n──────────────────────────────────────────────────────────");
    console.log(" AI features (Ask AI, agents, Claw)");
    console.log("──────────────────────────────────────────────────────────");
    console.log(" Everything else works without this. The AI features stay");
    console.log(" silent until they have an OpenAI-compatible endpoint —");
    console.log(" OpenAI, an internal gateway, or a local LiteLLM proxy.");
    console.log("");

    const wants = (await rl.question(" Set up AI access now? [y/N] ")).trim().toLowerCase();
    if (!wants.startsWith("y")) {
      console.log("\n Skipped. To enable it later, see docs/setup/ai-providers.md");
      return;
    }

    console.log("\n Press Enter to accept the value shown; edit it inline if you want.\n");

    const currentBase = readEnvValue(BACKEND_ENV, "LITELLM_BASE_URL") || readEnvValue(CLAW_ENV, "LITELLM_URL");
    const baseUrl = await ask(rl, "Base URL", currentBase || "https://api.openai.com/v1");
    if (!baseUrl) {
      console.log("\n No base URL given — skipping AI setup.");
      return;
    }

    const apiKey = await askApiKey(rl, readEnvValue(BACKEND_ENV, "LITELLM_API_KEY"));
    if (!apiKey) {
      console.log("\n No API key given — nothing written, AI features stay off.");
      console.log(" Configure it later: docs/setup/ai-providers.md");
      return;
    }

    const bestModel = await ask(rl, "Model for complex work", readEnvValue(BACKEND_ENV, "LITELLM_BEST_MODEL") || "gpt-4o");
    const fastModel = await ask(rl, "Model for quick tasks  ", readEnvValue(BACKEND_ENV, "LITELLM_FAST_MODEL") || "gpt-4o-mini");

    // Review before writing, so a typo does not go straight into the env files.
    console.log("\n About to write:");
    console.log(`   Base URL:  ${baseUrl}`);
    console.log(`   API key:   ${maskKey(apiKey)} (${apiKey.length} chars)`);
    console.log(`   Models:    ${bestModel} / ${fastModel}`);
    console.log("");
    const confirm = (await rl.question(" Write these to the env files? [Y/n] ")).trim().toLowerCase();
    if (confirm.startsWith("n")) {
      console.log("\n Nothing written. Re-run `pnpm run env:setup` to try again.");
      return;
    }

    // The two apps spell the base URL differently — backend reads LITELLM_BASE_URL,
    // xyne-claw reads LITELLM_URL. Setting only one leaves half the AI silent.
    const writes = [
      [BACKEND_ENV, "LITELLM_BASE_URL", baseUrl],
      [BACKEND_ENV, "LITELLM_API_KEY", apiKey],
      [BACKEND_ENV, "LITELLM_BEST_MODEL", bestModel],
      [BACKEND_ENV, "LITELLM_FAST_MODEL", fastModel],
      [CLAW_ENV, "LITELLM_URL", baseUrl],
      [CLAW_ENV, "LITELLM_API_KEY", apiKey],
      [CLAW_ENV, "LITELLM_MODEL", bestModel],
    ];

    const touched = new Set();
    for (const [file, key, value] of writes) {
      if (upsertEnvValue(file, key, value)) touched.add(file);
      else console.warn(`   ⚠️  ${file} not found — skipped ${key}`);
    }

    console.log("");
    for (const file of touched) console.log(` ✓ Updated ${file}`);
    console.log("\n Checking the endpoint answers...");
    const ping = await pingModel(baseUrl, apiKey, bestModel);
    reportPing(ping);
    if (!ping.ok) {
      console.log("   The values above are saved — fix them and re-check with `pnpm run doctor:llm`.");
    }
  } catch (error) {
    // stdin closing mid-prompt (Ctrl+D, a piped heredoc running out, a runner that
    // detaches the terminal) rejects the pending question. Treat it as "skip" —
    // this runs inside `pnpm run bootstrap`, and crashing here would take the whole
    // chain down over an optional step.
    if (error?.code === 'ABORT_ERR') {
      console.log("\n\n Input closed — skipping AI setup.");
      console.log(" Configure it later: docs/setup/ai-providers.md");
      return;
    }
    throw error;
  } finally {
    rl.close();
  }
}

await configureAi();

if (created > 0) {
  console.log("\nReview the new files and fill in any other values you need (OAuth creds).");
}
