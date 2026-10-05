/**
 * Environment construction for stdio MCP child processes (XYNE-65520, C-7
 * containment; parent XYNE-65483).
 *
 * Historically every stdio MCP server — including ~18 third-party npm packages
 * launched via npx — was spawned with `{ ...process.env, ...adapterEnv }`, so
 * each child inherited claw-auth's whole environment: both root S2S keys
 * (INTERNAL_S2S_KEY, XYNE_CLAW_S2S_KEY), the DB URLs and the encryption /
 * signing keys. One malicious npm release of any of those packages could read
 * them and impersonate any user across Spaces, claw-auth and the Claw runtime.
 *
 * With `MCP_CHILD_ENV_ALLOWLIST` on:
 *   - THIRD-PARTY children (anything that is not one of our in-tree servers)
 *     get a minimal allowlist (PATH, HOME, locale, proxy, non-secret NODE_*)
 *     plus exactly the env their adapter declares. Nothing else.
 *   - FIRST-PARTY children (our own `src/mcp/servers/*` code, same trust as this
 *     process) still inherit the parent env, because they import `config.ts`
 *     (which hard-requires ENCRYPTION_KEY at import) and `lib/spaces-db.ts`.
 *     KNOWN EXCEPTION — TODO(XYNE-65483): move them to an allowlist once the
 *     signed delegation token replaces the shared key. Even so, every `*_S2S_KEY`
 *     is stripped from the inherited env: a first-party child holds an S2S key
 *     only if its adapter passes it explicitly (the four Spaces adapters pass
 *     INTERNAL_S2S_KEY and nothing else).
 *
 * With the flag off the legacy behaviour is preserved exactly, so the flag is a
 * clean rollback switch.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Exact variable names a third-party child may inherit. */
const EXACT_ALLOW = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

/** Prefixes a third-party child may inherit, subject to the secret filter. */
const PREFIX_ALLOW = ["LC_", "NODE_", "npm_config_"];

/**
 * Anything whose NAME looks like a credential is never inherited through the
 * allowlist, even when it matches an allowed prefix (e.g. `NODE_AUTH_TOKEN`,
 * `npm_config__authToken`). Adapter-declared env is not filtered — it is
 * code-reviewed and is how a child legitimately receives its own credential.
 */
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|DATABASE_URL|_DSN|COOKIE|SESSION)/i;

/** Root service-to-service keys. Stripped from every child unless the adapter passes one explicitly. */
const S2S_KEY_NAME = /_S2S_KEY$/;

export const MCP_CHILD_ENV_ALLOWLIST_FLAG = "MCP_CHILD_ENV_ALLOWLIST";

export function isChildEnvAllowlistEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "on", "yes"].includes(String(env[MCP_CHILD_ENV_ALLOWLIST_FLAG] ?? "").trim().toLowerCase());
}

export function isAllowlistedForThirdParty(name: string): boolean {
  if (EXACT_ALLOW.has(name)) return true;
  if (!PREFIX_ALLOW.some((p) => name.startsWith(p))) return false;
  return !SECRET_NAME.test(name);
}

const FIRST_PARTY_SERVERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "servers") + path.sep;

/**
 * A launch is first-party when it executes a file from our own
 * `src/mcp/servers/` directory (e.g. `node --import tsx/esm <servers/x.ts>`).
 * stdio launches only ever come from code-reviewed static adapters
 * (connector-definitions.ts refuses DB-defined stdio commands), so a path
 * argument inside that directory cannot be attacker-chosen.
 */
export function isFirstPartyLaunch(args: readonly string[], serversDir: string = FIRST_PARTY_SERVERS_DIR): boolean {
  const dir = serversDir.endsWith(path.sep) ? serversDir : serversDir + path.sep;
  return args.some((a) => path.isAbsolute(a) && path.resolve(a).startsWith(dir));
}

function definedOnly(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Minimal inherited environment for an untrusted (third-party) process. */
export function pickAllowlistedEnv(parentEnv: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (typeof v === "string" && isAllowlistedForThirdParty(k)) out[k] = v;
  }
  return out;
}

export interface BuildChildEnvOptions {
  /** Env declared by the adapter's buildCommand(). Always passed through verbatim. */
  adapterEnv: Record<string, string | undefined>;
  /** Whether the launch runs our own in-tree server code. */
  firstParty: boolean;
  /** The parent process env. Defaults to `process.env`. */
  parentEnv?: NodeJS.ProcessEnv;
  /** Overrides the MCP_CHILD_ENV_ALLOWLIST flag (tests). */
  allowlistEnabled?: boolean;
}

export function buildChildEnv(opts: BuildChildEnvOptions): Record<string, string> {
  const parentEnv = opts.parentEnv ?? process.env;
  const adapterEnv = definedOnly(opts.adapterEnv);
  const enabled = opts.allowlistEnabled ?? isChildEnvAllowlistEnabled(parentEnv);

  if (!enabled) {
    // Legacy behaviour — unchanged, so turning the flag off is a true rollback.
    return { ...definedOnly(parentEnv), ...adapterEnv };
  }

  if (!opts.firstParty) {
    return { ...pickAllowlistedEnv(parentEnv), ...adapterEnv };
  }

  const inherited = definedOnly(parentEnv);
  for (const k of Object.keys(inherited)) {
    if (S2S_KEY_NAME.test(k)) delete inherited[k];
  }
  return { ...inherited, ...adapterEnv };
}
