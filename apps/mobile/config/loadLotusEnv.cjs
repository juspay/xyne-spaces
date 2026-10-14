/**
 * Load Lotus variant env files before Expo / Metro read `process.env`.
 * Maps `APP_VARIANT` → `.env.dev` | `.env.prod` | `.env.sandbox` | `.env.community` (project root).
 * Default when unset is `prod` (see `resolveVariantKey` in `variants.cjs`).
 *
 * Also mirrors non-Expo keys from apps/legacy-style `.env.*` into `EXPO_PUBLIC_*`
 * so Metro can inline them into the JS bundle.
 *
 * Logs effective variables at startup (prefix `[Lotus env]`). Set `LOTUS_ENV_LOG=0` to disable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG = '[Lotus env]';

/** Set `LOTUS_ENV_LOG=0` to silence startup env logs (e.g. CI). */
function envLoggingEnabled() {
  return process.env.LOTUS_ENV_LOG !== '0';
}

/**
 * Log effective env: safe to print `EXPO_PUBLIC_*` (bundled into the app anyway).
 * Other keys: only whether they are set, not values (secrets).
 */
function logEffectiveEnv(variantKey, rel, file, loadedOk) {
  if (!envLoggingEnabled()) {
    return;
  }

  if (!loadedOk) {
    if (!fs.existsSync(file)) {
      console.warn(`${LOG} APP_VARIANT=${variantKey} — no file ${rel} (skipped)`);
    } else {
      console.warn(`${LOG} APP_VARIANT=${variantKey} — failed to load ${rel}`);
    }
    return;
  }

  console.log(`${LOG} APP_VARIANT=${variantKey} — loaded ${rel}`);

  const expoPublic = Object.keys(process.env)
    .filter(k => k.startsWith('EXPO_PUBLIC_'))
    .sort();
  for (const k of expoPublic) {
    const v = process.env[k];
    console.log(`${LOG}   ${k}=${v ?? ''}`);
  }

  const flags = ['APP_ENV', 'MTLS_ENABLED', 'WEBVIEW_DEBUGGING_ENABLED', 'LOTUS_APS_ENVIRONMENT'];
  for (const k of flags) {
    if (process.env[k] !== undefined) {
      console.log(`${LOG}   ${k}=${process.env[k]}`);
    }
  }

  const secretish = [
    'MIXPANEL_TOKEN',
    'GOOGLE_WEB_CLIENT_ID',
    'GOOGLE_IOS_CLIENT_ID',
    'LOTUS_RELEASE_STORE_PASSWORD',
    'LOTUS_RELEASE_KEY_PASSWORD',
  ];
  for (const k of secretish) {
    if (process.env[k]) {
      console.log(`${LOG}   ${k}=(set, ${process.env[k].length} chars)`);
    }
  }
}

/** @param {string} relFromRoot */
function envPath(relFromRoot) {
  return path.join(ROOT, relFromRoot);
}

function mirrorExpoPublicFromLegacyEnv() {
  if (!process.env.EXPO_PUBLIC_API_BASE_URL && process.env.API_BASE_URL) {
    process.env.EXPO_PUBLIC_API_BASE_URL = process.env.API_BASE_URL.trim();
  }

  if (!process.env.EXPO_PUBLIC_DASHBOARD_ORIGIN && process.env.DASHBOARD_URL) {
    const raw = process.env.DASHBOARD_URL.trim();
    try {
      process.env.EXPO_PUBLIC_DASHBOARD_ORIGIN = new URL(raw).origin;
    } catch {
      process.env.EXPO_PUBLIC_DASHBOARD_ORIGIN = raw.replace(/\/$/, '');
    }
  }

  if (!process.env.EXPO_PUBLIC_ZERO_SERVER_URL && process.env.ZERO_SERVER_URL) {
    process.env.EXPO_PUBLIC_ZERO_SERVER_URL = process.env.ZERO_SERVER_URL.trim();
  }

  if (!process.env.EXPO_PUBLIC_APP_ENV && process.env.APP_ENV) {
    process.env.EXPO_PUBLIC_APP_ENV = process.env.APP_ENV.trim();
  }

  if (!process.env.EXPO_PUBLIC_MTLS_ENABLED && process.env.MTLS_ENABLED !== undefined) {
    process.env.EXPO_PUBLIC_MTLS_ENABLED = String(process.env.MTLS_ENABLED).trim();
  }

  if (!process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_ID) {
    process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID.trim();
  }

  if (!process.env.EXPO_PUBLIC_MICROSOFT_TENANT_ID && process.env.MICROSOFT_TENANT_ID) {
    process.env.EXPO_PUBLIC_MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID.trim();
  }
}

function loadLotusEnv() {
  let variantKey;
  try {
    const { resolveVariantKey } = require('./variants.cjs');
    variantKey = resolveVariantKey(process.env.APP_VARIANT);
  } catch (e) {
    if (envLoggingEnabled()) {
      console.warn(`${LOG} invalid APP_VARIANT: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }

  const fileByVariant = {
    dev: '.env.dev',
    prod: '.env.prod',
    sandbox: '.env.sandbox',
    community: '.env.community',
  };
  const rel = fileByVariant[variantKey];
  if (!rel) {
    return;
  }

  const file = envPath(rel);
  if (!fs.existsSync(file)) {
    logEffectiveEnv(variantKey, rel, file, false);
    return;
  }

  let loadedOk = false;
  try {
    // eslint-disable-next-line global-require -- load after file check
    require('dotenv').config({ path: file, override: true });
    loadedOk = true;
  } catch {
    logEffectiveEnv(variantKey, rel, file, false);
    return;
  }

  mirrorExpoPublicFromLegacyEnv();
  logEffectiveEnv(variantKey, rel, file, loadedOk);
}

module.exports = { loadLotusEnv };
