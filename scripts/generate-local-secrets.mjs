#!/usr/bin/env node
/**
 * Generate missing local development secrets without replacing user values.
 * Shared backend/encryption secrets are selected once and written to both files.
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
const encryptionPath = join(repoRoot, "apps", "encryption", ".env.local");
const webPushPath = join(backendDir, "node_modules", "web-push", "src", "index.js");

for (const envPath of [backendPath, encryptionPath]) {
  if (!existsSync(envPath)) {
    console.error(`${envPath} not found`);
    process.exit(1);
  }
}

const files = new Map([
  [backendPath, readFileSync(backendPath, "utf8")],
  [encryptionPath, readFileSync(encryptionPath, "utf8")],
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
  console.log(`Generated ${key} in ${envPath === backendPath ? "backend" : "encryption"} env`);
  return true;
}

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

function syncSharedSecret(key) {
  const backendValue = readValue(backendPath, key);
  const encryptionValue = readValue(encryptionPath, key);
  const backendSet = !isPlaceholder(backendValue);
  const encryptionSet = !isPlaceholder(encryptionValue);

  if (backendSet && encryptionSet && backendValue !== encryptionValue) {
    throw new Error(`${key} differs between backend and encryption env files; reconcile it manually`);
  }

  const sharedValue = backendSet ? backendValue : encryptionSet ? encryptionValue : randomHex(48);
  setValue(backendPath, key, sharedValue);
  setValue(encryptionPath, key, sharedValue);
}

syncSharedSecret("JWT_SECRET");
syncSharedSecret("ENC_S2S_KEY");

setValue(backendPath, "ZERO_AUTH_SECRET", randomHex(48));
setValue(backendPath, "ENCRYPTION_KEY", randomHex(32));

if ((readValue(encryptionPath, "KMS_ENC_PROVIDER") || "env") === "env") {
  setValue(encryptionPath, "ENC_ENV_MASTER_KEY_HEX", randomHex(32));
}

let vapidKeys = null;
try {
  const webPush = await import(webPushPath);
  const generateVAPIDKeys = webPush.default?.generateVAPIDKeys || webPush.generateVAPIDKeys;
  vapidKeys = generateVAPIDKeys();
} catch (err) {
  console.warn(`Could not generate VAPID keys: ${err instanceof Error ? err.message : String(err)}`);
}

if (vapidKeys) {
  setValue(backendPath, "VAPID_PUBLIC_KEY", vapidKeys.publicKey);
  setValue(backendPath, "VAPID_PRIVATE_KEY", vapidKeys.privateKey);
}

for (const [envPath, contents] of files) {
  writeFileSync(envPath, contents);
}
