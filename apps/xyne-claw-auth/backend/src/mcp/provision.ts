import { errMsg } from "../lib/errors.js";
import {
  mkdtempSync,
  existsSync,
  rmSync,
  renameSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { createLogger } from "../logger.js";
const log = createLogger("provision");

/**
 * Hardened provisioner for `npx`-launched MCP servers.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Launching a server with `npx -y <pkg>` installs the package into ONE shared,
 * mutable cache directory (`~/.npm/_npx/<hash>`). The hash is deterministic per
 * package spec, so every concurrent agent run that needs the same server points
 * at the SAME directory. npm's install is not atomic across the dependency
 * tree, so when two installs race — or one is killed mid-install by a SIGTERM /
 * eviction — the tree is left half-written (classic signature: `node-fetch`
 * present but its transitive dep `data-uri-to-buffer` missing). Because the
 * directory still EXISTS, npx's cache-hit path never repairs it, so EVERY later
 * run reuses the broken tree and the server dies at startup with
 * `ERR_MODULE_NOT_FOUND` → the stdio pipe closes → `MCP error -32000:
 * Connection closed` → claw loads 0 tools for that server. It stays broken
 * until the pod restarts, then rots again on the next race. A boot-time cache
 * scrub cannot win a runtime race.
 *
 * ── The fix (four guarantees) ──────────────────────────────────────────────
 *  1. One package → one ISOLATED directory keyed by name@version. Nothing is
 *     shared, so cross-run / cross-package races are impossible.
 *  2. ATOMIC publish: install into a private temp dir, then `rename()` it into
 *     place. rename is atomic on one filesystem, so a concurrent reader sees
 *     either the old-complete or new-complete tree, never a half-written one.
 *  3. SINGLE-FLIGHT per package (in-process) so we don't stampede npm.
 *  4. INTEGRITY gate = self-healing: an unhealthy existing dir is replaced
 *     instead of reused, so corruption can never become sticky.
 *
 * Then we spawn `node <entrypoint>` directly — NOT npx — so nothing fetches or
 * installs at request time. Build-time prewarm (scripts/prewarm-mcp.ts)
 * populates the store inside the image so built-ins never touch the network.
 *
 * Fail-safe: if provisioning fails for any reason we return the ORIGINAL npx
 * command, so this can never make things worse than the status quo.
 */

const STORE_ROOT =
  process.env["MCP_STORE_ROOT"] ??
  path.join(process.env["HOME"] ?? "/tmp", ".mcp-store");
const TMP_ROOT = path.join(STORE_ROOT, ".tmp");
const READY_MARKER = ".mcp-ready";
const INSTALL_TIMEOUT_MS = 180_000;

// In-process single-flight: concurrent runs in THIS process that need the same
// package await one install instead of each kicking off their own.
const inflight = new Map<string, Promise<string>>();

/** npx provisioning flags we skip while looking for the package spec. */
function isNpxFlag(arg: string): boolean {
  return arg === "-y" || arg === "--yes" || arg === "-q" || arg === "--quiet";
}

/**
 * Split npx args into the package spec and the trailing args handed to the
 * server. e.g. `["-y", "amplitude-mcp-server", "--api-key", "x"]`
 *   → { spec: "amplitude-mcp-server", serverArgs: ["--api-key", "x"] }
 * Returns null if we can't confidently identify a package spec (we then fall
 * back to the original npx command).
 */
function parseNpxArgs(args: string[]): { spec: string; serverArgs: string[] } | null {
  let i = 0;
  while (i < args.length && isNpxFlag(args[i]!)) i++;
  if (i >= args.length) return null;
  const spec = args[i]!;
  // `-p`/`--package` style or any leftover flag → too exotic, let npx handle it.
  if (spec.startsWith("-")) return null;
  return { spec, serverArgs: args.slice(i + 1) };
}

/**
 * Parse an npm package spec into name + optional version, handling scopes:
 *   "@scope/name@1.2.3" → { name: "@scope/name", version: "1.2.3" }
 *   "@scope/name"       → { name: "@scope/name" }
 *   "name@latest"       → { name: "name", version: "latest" }
 *   "name"              → { name: "name" }
 */
function parseSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  // at <= 0 means either no "@" (-1) or only the leading scope "@" (0) → no version.
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** Filesystem-safe directory name for a package@version. */
function storeKey(name: string, version?: string): string {
  const raw = version ? `${name}@${version}` : name;
  return raw.replace(/\//g, "+").replace(/[^a-zA-Z0-9._@+-]/g, "_");
}

/**
 * Resolve the executable entrypoint of an installed package by reading its
 * package.json `bin` field (mirrors how npx picks what to run).
 */
function resolveEntrypoint(pkgDir: string, name: string): string {
  const pj = JSON.parse(
    readFileSync(path.join(pkgDir, "package.json"), "utf8"),
  ) as { bin?: string | Record<string, string>; main?: string };

  const shortName = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  let rel: string | undefined;
  if (typeof pj.bin === "string") {
    rel = pj.bin;
  } else if (pj.bin && typeof pj.bin === "object") {
    rel = pj.bin[shortName] ?? Object.values(pj.bin)[0];
  }
  rel = rel ?? pj.main ?? "index.js";
  return path.join(pkgDir, rel);
}

/**
 * Healthy = published marker present AND the package + its entrypoint exist.
 * Our installs are isolated and atomically published, so a marked dir is
 * internally consistent; this also rejects any externally-corrupted tree so it
 * gets reinstalled instead of reused.
 */
function isHealthy(dir: string, name: string): boolean {
  try {
    if (!existsSync(path.join(dir, READY_MARKER))) return false;
    const pkgDir = path.join(dir, "node_modules", name);
    if (!existsSync(path.join(pkgDir, "package.json"))) return false;
    return existsSync(resolveEntrypoint(pkgDir, name));
  } catch {
    return false;
  }
}

/** Atomically move a freshly-installed temp dir into its final location. */
function publish(tmp: string, dir: string, name: string): void {
  try {
    // Fast path: destination doesn't exist yet.
    renameSync(tmp, dir);
    return;
  } catch {
    // Destination exists (another process won the race) or is stale.
  }
  if (isHealthy(dir, name)) return; // someone published a good copy — use theirs.
  // Stale/corrupt existing dir: swap it out with a tiny window, then drop it.
  const broken = `${dir}.broken-${process.pid}-${Date.now()}`;
  try {
    renameSync(dir, broken);
  } catch {
    /* concurrent swap — fall through */
  }
  try {
    renameSync(tmp, dir);
  } catch {
    /* another process published first; our tmp is cleaned up by caller */
  }
  try {
    rmSync(broken, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** Install `name[@version]` into its isolated store dir (temp → atomic rename). */
async function install(name: string, version: string | undefined, dir: string): Promise<void> {
  mkdirSync(TMP_ROOT, { recursive: true });
  const tmp = mkdtempSync(path.join(TMP_ROOT, "install-"));
  try {
    const spec = version ? `${name}@${version}` : name;
    writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "mcp-host", version: "0.0.0", private: true }),
    );
    execFileSync(
      "npm",
      [
        "install",
        spec,
        "--prefix",
        tmp,
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--omit=dev",
        "--loglevel=error",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: INSTALL_TIMEOUT_MS,
        env: { ...process.env, npm_config_update_notifier: "false" },
      },
    );

    // Verify the install produced a usable tree BEFORE we publish it.
    const pkgDir = path.join(tmp, "node_modules", name);
    if (!existsSync(path.join(pkgDir, "package.json"))) {
      throw new Error(`npm install produced no node_modules/${name}`);
    }
    if (!existsSync(resolveEntrypoint(pkgDir, name))) {
      throw new Error(`entrypoint missing for ${name} after install`);
    }
    writeFileSync(path.join(tmp, READY_MARKER), `${spec}\n${new Date().toISOString()}\n`);

    publish(tmp, dir, name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Ensure the package is provisioned and return its installed package dir. */
async function ensureProvisioned(
  name: string,
  version: string | undefined,
  key: string,
): Promise<string> {
  const dir = path.join(STORE_ROOT, key);
  const pkgDir = path.join(dir, "node_modules", name);

  if (isHealthy(dir, name)) return pkgDir;

  const existing = inflight.get(key);
  if (existing) {
    await existing;
    if (isHealthy(dir, name)) return pkgDir;
  }

  const job = install(name, version, dir);
  inflight.set(key, job.then(() => pkgDir));
  try {
    await job;
  } finally {
    inflight.delete(key);
  }

  if (!isHealthy(dir, name)) {
    throw new Error(`provisioning did not yield a healthy tree for ${name}`);
  }
  return pkgDir;
}

/**
 * Transform a stdio launch command so npx servers run from an isolated,
 * pre-provisioned store via `node <entrypoint>` instead of installing at
 * spawn time. Non-npx commands (TS-source MCPs, HTTP, etc.) pass through
 * unchanged. Never throws — falls back to the original command on any error.
 */
export async function provisionStdioCommand(
  cmd: string,
  args: string[],
): Promise<{ command: string; args: string[] }> {
  if (cmd !== "npx") return { command: cmd, args };

  const parsed = parseNpxArgs(args);
  if (!parsed) return { command: cmd, args };

  const { name, version } = parseSpec(parsed.spec);
  const key = storeKey(name, version);

  try {
    const pkgDir = await ensureProvisioned(name, version, key);
    const entrypoint = resolveEntrypoint(pkgDir, name);
    return { command: "node", args: [entrypoint, ...parsed.serverArgs] };
  } catch (err) {
    log.warn(
      `[mcp/provision] ${parsed.spec}: provisioning failed, falling back to npx — ${
        errMsg(err)
      }`,
    );
    return { command: cmd, args };
  }
}

/**
 * Extract the npm package spec (e.g. "@scope/name" or "name@1.2.3") from a
 * stdio launch command, or null if it isn't an npx-launched server. Lets the
 * prewarm script derive its package list straight from the adapter registry
 * instead of a hand-maintained list.
 */
export function npxPackageSpec(cmd: string, args: string[]): string | null {
  if (cmd !== "npx") return null;
  return parseNpxArgs(args)?.spec ?? null;
}

/** Used by the build-time prewarm script to populate the store in the image. */
export async function prewarmSpec(spec: string): Promise<boolean> {
  const { name, version } = parseSpec(spec);
  const key = storeKey(name, version);
  try {
    await ensureProvisioned(name, version, key);
    log.info(`[mcp/provision] prewarmed ${spec}`);
    return true;
  } catch (err) {
    log.error(
      `[mcp/provision] prewarm FAILED for ${spec}: ${errMsg(err)}`,
    );
    return false;
  }
}
