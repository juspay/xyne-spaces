#!/usr/bin/env node
/**
 * Generate local dev secrets in backend/.env.local.
 *
 * Only replaces placeholder/empty values so a developer's real secrets are never
 * overwritten. Called by scripts/start-services.sh after .env.local is created
 * from .env.example.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(repoRoot, "backend", ".env.local");
const webPushPath = join(repoRoot, "backend", "node_modules", "web-push", "src", "index.js");

if (!existsSync(envPath)) {
  console.error("backend/.env.local not found");
  process.exit(1);
}

let env = readFileSync(envPath, "utf8");

function setIfPlaceholder(key, newValue, isPlaceholder) {
  const regex = new RegExp(`^(${key}=).*?$`, "gm");
  let replaced = false;
  env = env.replace(regex, (match, prefix) => {
    const currentValue = match.slice(prefix.length);
    if (isPlaceholder(currentValue)) {
      replaced = true;
      console.log(`Generated ${key}`);
      return `${prefix}${newValue}`;
    }
    return match;
  });
  return replaced;
}

let vapidKeys = null;
try {
  const webPush = await import(webPushPath);
  const generateVAPIDKeys = webPush.default?.generateVAPIDKeys || webPush.generateVAPIDKeys;
  vapidKeys = generateVAPIDKeys();
} catch (err) {
  console.warn(`Could not generate VAPID keys: ${err instanceof Error ? err.message : String(err)}`);
}

const PLACEHOLDER_PATTERNS = /^(set-me|changeme|placeholder|REPLACE_WITH.*|YOUR_.*|.*example\.com.*)$/i;

function isPlaceholder(value) {
  const v = (value ?? "").trim();
  return v.length === 0 || PLACEHOLDER_PATTERNS.test(v);
}

// JWT-style secrets: 48 random bytes → 96 hex chars (well above 32-char minimum)
setIfPlaceholder("JWT_SECRET", randomBytes(48).toString("hex"), isPlaceholder);
setIfPlaceholder("ZERO_AUTH_SECRET", randomBytes(48).toString("hex"), isPlaceholder);

// AES-256-GCM: 32 bytes → 64 hex chars
setIfPlaceholder("ENCRYPTION_KEY", randomBytes(32).toString("hex"), isPlaceholder);

if (vapidKeys) {
  setIfPlaceholder("VAPID_PUBLIC_KEY", vapidKeys.publicKey, isPlaceholder);
  setIfPlaceholder("VAPID_PRIVATE_KEY", vapidKeys.privateKey, isPlaceholder);
}

writeFileSync(envPath, env);
