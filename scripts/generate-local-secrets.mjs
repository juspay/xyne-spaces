#!/usr/bin/env node
/**
 * Generate missing local development secrets without replacing user values.
 * Generate backend development secrets without replacing user values.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = process.env.XYNE_REPO_ROOT || defaultRoot;
const backendDir = existsSync(join(repoRoot, "apps", "backend"))
  ? join(repoRoot, "apps", "backend")
  : join(repoRoot, "backend");
const backendPath = join(backendDir, ".env.local");

for (const envPath of [backendPath]) {
  if (!existsSync(envPath)) {
    console.error(`${envPath} not found`);
    process.exit(1);
  }
}

const files = new Map([
  [backendPath, readFileSync(backendPath, "utf8")],
]);
const PLACEHOLDER_PATTERNS = /^(set-me|change-?me.*|placeholder|replace-with-.*|REPLACE_WITH.*|YOUR_.*|.*example\.com.*)$/i;

function isPlaceholder(value) {
  const normalized = (value ?? "").trim();
  return normalized.length === 0 || PLACEHOLDER_PATTERNS.test(normalized);
}

function readValue(envPath, key) {
  const match = [...files.get(envPath).matchAll(new RegExp(`^${key}=(.*)$`, "gm"))].at(-1);
  return match?.[1]?.trim() ?? "";
}

function setValue(envPath, key, value, onlyPlaceholder = true) {
  let contents = files.get(envPath);
  const regex = new RegExp(`^${key}=.*$`, "gm");
  const current = readValue(envPath, key);
  if (onlyPlaceholder && !isPlaceholder(current)) return false;

  if (regex.test(contents)) {
    contents = contents.replace(regex, `${key}=${value}`);
  } else {
    contents = `${contents.replace(/\n?$/, "\n")}${key}=${value}\n`;
  }
  files.set(envPath, contents);
  console.log(`Generated ${key} in backend env`);
  return true;
}

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

setValue(backendPath, "JWT_SECRET", randomHex(48));

setValue(backendPath, "ZERO_AUTH_SECRET", randomHex(48));
setValue(backendPath, "ENCRYPTION_KEY", randomHex(32));

for (const [envPath, contents] of files) {
  writeFileSync(envPath, contents);
}
