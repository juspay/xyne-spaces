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

// JWT-style secrets: 48 random bytes → 96 hex chars (well above 32-char minimum)
setIfPlaceholder(
  "JWT_SECRET",
  randomBytes(48).toString("hex"),
  (v) => v.length < 32 || v.toLowerCase().includes("secret"),
);

setIfPlaceholder(
  "ZERO_AUTH_SECRET",
  randomBytes(48).toString("hex"),
  (v) => v.length < 32 || v.toLowerCase().includes("secret"),
);

// AES-256-GCM: 32 bytes → 64 hex chars
setIfPlaceholder(
  "ENCRYPTION_KEY",
  randomBytes(32).toString("hex"),
  (v) => !/^[0-9a-fA-F]{64}$/.test(v) || v.toLowerCase().includes("key"),
);

if (vapidKeys) {
  setIfPlaceholder(
    "VAPID_PUBLIC_KEY",
    vapidKeys.publicKey,
    (v) => v.trim().length === 0 || v.toLowerCase().includes("vapid"),
  );
  setIfPlaceholder(
    "VAPID_PRIVATE_KEY",
    vapidKeys.privateKey,
    (v) => v.trim().length === 0 || v.toLowerCase().includes("vapid"),
  );
}

writeFileSync(envPath, env);
