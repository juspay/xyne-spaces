import { X509Certificate, createPrivateKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SsoConfig } from "./sso.js";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(APP_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export const DEFAULT_SSO_DIR = path.join(APP_ROOT, "sso");
/** Placeholder sign-in URL: it never has to exist, the bot answers it in its own browser. */
export const DEFAULT_SSO_SIGN_IN_URL = "https://sso.xyne-automatic.internal/saml/sign-in";

/** A PEM from `<name>` (contents, `\n` allowed) or the file `<name>_FILE`, else `fallbackFile`. */
function pem(name: string, fallbackFile: string): string | null {
  const inline = process.env[name]?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = process.env[`${name}_FILE`]?.trim() || fallbackFile;
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * The SSO sign-in of the bot account, or null when SSO_EMAIL isn't set. Checks the
 * key and certificate up front, so a broken setup fails at startup, not in a meeting.
 */
function loadSso(): SsoConfig | null {
  const email = process.env.SSO_EMAIL?.trim();
  if (!email) return null;
  const privateKey = pem("SSO_PRIVATE_KEY", path.join(DEFAULT_SSO_DIR, "idp-key.pem"));
  const certificate = pem("SSO_CERTIFICATE", path.join(DEFAULT_SSO_DIR, "idp-cert.pem"));
  if (!privateKey || !certificate) {
    throw new Error("SSO_EMAIL is set but the SSO key or certificate is missing: run `pnpm --filter meet-bot sso:setup`");
  }
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certificate);
    if (!cert.checkPrivateKey(createPrivateKey(privateKey))) throw new Error("they are not a pair");
  } catch (error) {
    throw new Error(`SSO key or certificate is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (Date.parse(cert.validTo) <= Date.now()) throw new Error(`The SSO certificate expired on ${cert.validTo}`);
  const signInUrl = process.env.SSO_SIGN_IN_URL?.trim() || DEFAULT_SSO_SIGN_IN_URL;
  if (!/^https:\/\//i.test(signInUrl)) throw new Error("SSO_SIGN_IN_URL must be an https URL");
  return {
    email,
    signInUrl,
    entityId: process.env.SSO_ENTITY_ID?.trim() || signInUrl,
    privateKey,
    certificate,
  };
}

export interface Config {
  port: number;
  apiKey: string;
  botName: string;
  /** How the bot signs its Google account in (src/sso.ts); null: it can only join as a guest. */
  sso: SsoConfig | null;
  /** Join as an anonymous guest (host must admit) when SSO isn't configured. */
  allowGuest: boolean;
  chromePath: string | undefined;
  browserChannel: string | undefined;
  muteAudio: boolean;
  /**
   * In docker the URLs the backend hands out (its own callback URL, LiveKit) can name
   * the host as "localhost"; these replace them with addresses reachable from the
   * container (e.g. http://host.containers.internal:3001, ws://livekit:7880).
   */
  backendUrlOverride: string | undefined;
  livekitUrlOverride: string | undefined;
  maxConcurrentSessions: number;
  waitingRoomTimeoutMs: number;
  aloneTimeoutMs: number;
  maxMeetingMs: number;
}

export function loadConfig(): Config {
  const chromePath = process.env.CHROME_PATH?.trim() || undefined;
  return {
    port: int("PORT", 3010),
    apiKey: process.env.MEET_BOT_API_KEY?.trim() ?? "",
    botName: process.env.BOT_NAME?.trim() || "Xyne Automatic",
    sso: loadSso(),
    allowGuest: bool("ALLOW_GUEST_JOIN", false),
    chromePath,
    // Real Google Chrome looks like any desktop browser to Meet; bundled Chromium is a fallback.
    browserChannel: chromePath ? undefined : process.env.BROWSER_CHANNEL?.trim() || "chrome",
    muteAudio: bool("MUTE_AUDIO", true),
    backendUrlOverride: process.env.BACKEND_URL_OVERRIDE?.trim() || undefined,
    livekitUrlOverride: process.env.LIVEKIT_URL_OVERRIDE?.trim() || undefined,
    maxConcurrentSessions: int("MAX_CONCURRENT_SESSIONS", 4),
    waitingRoomTimeoutMs: int("WAITING_ROOM_TIMEOUT_SECONDS", 600) * 1000,
    aloneTimeoutMs: int("ALONE_TIMEOUT_SECONDS", 30) * 1000,
    maxMeetingMs: int("MAX_MEETING_MINUTES", 240) * 60_000,
  };
}
