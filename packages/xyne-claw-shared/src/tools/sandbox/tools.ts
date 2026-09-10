import { KataClient } from "@xyne/kata-sdk";
import type { Session } from "@xyne/kata-sdk";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { SDLC_AGENT_SLUG, SDLC_TOOL_NAMES } from "../../sdlc/registry.js";
import { resolveSdlcRepositoryIntoMeta } from "../../sdlc/resolve.js";
import { redactSecrets, redactAndStringify } from "./redact.js";
import { rotateTemplate, isSameTemplateFamily } from "./template-rotation.js";
import { formatSandboxUnavailable, isSandboxUnavailableDeferEnabled } from "./unavailable-signal.js";
import { createLogger } from "../../logger.js";
import { readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import {
  cleanupSdlcGitCredentialMaterial,
  installSdlcGitCredentialBootstrap,
  type SdlcRuntimeCredentialBinding,
} from "./sdlc-credential-bootstrap.js";
import { classifyWikiCommitRelevance, parseWikiNameStatus } from "./sdlc-wiki-policy.js";

const sandboxLog = createLogger("sandbox-tools");

// Build a redacted `Error: ...` string from a caught error. Several tool
// catch blocks interpolate err.message straight into tool output, which can
// echo secrets surfaced by the failing command. Route them through this.
function sandboxErr(err: unknown): string {
  return `Error: ${redactSecrets(err instanceof Error ? err.message : String(err))}`;
}

// Reject paths that resolve to known credential locations so they can't be
// exfiltrated as base64/binary (which bypasses pattern redaction on text reads).
function isCredentialPath(p: string): boolean {
  const s = p.toLowerCase();
  return /(^|\/)\.ssh(\/|$)|id_rsa|id_ed25519|\.git-credentials|\.sdlc-git-credential|\/tmp\/ssh-keys|\/tmp\/github-ssh-keys|\/tmp\/attic|\.netrc|\.npmrc|\.docker\/config|known_hosts/.test(s);
}

const SESSION_STORE = new Map<string, Session>();

// Single-flight for sandbox-repo-setup, keyed by (user, conversation).
//
// A cold claim takes 5-7 min (warm pool is 2 replicas; past that each claim
// cold-boots a Kata microVM). The model does not know that, so on "destroy this
// one and get a new one" it fired three setups 20:42/20:44:55/20:45:37 that ran
// CONCURRENTLY, exhausted the warm pool and turned one request into ~9 min of
// churn (measured 2026-08-29). Prompt guidance cannot make this safe — a second
// call is never what the user wanted, so it is coalesced onto the first here:
// the later callers await the same provisioning and get the same session back
// instead of claiming more pods.
const REPO_SETUP_INFLIGHT = new Map<string, Promise<string>>();

function withRepoSetupSingleFlight(tool: ToolDefinition): ToolDefinition {
  const run = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(params, context) {
      const key = context ? storeKeyFromContext(context) : undefined;
      if (!key) return run(params, context);
      const inflight = REPO_SETUP_INFLIGHT.get(key);
      if (inflight) return inflight;
      const started = (async () => run(params, context))();
      REPO_SETUP_INFLIGHT.set(key, started);
      void started
        .catch(() => undefined)
        .finally(() => {
          if (REPO_SETUP_INFLIGHT.get(key) === started) REPO_SETUP_INFLIGHT.delete(key);
        });
      return started;
    },
  };
}
interface SessionOwner {
  userId: string;
  conversationId: string;
  agentSlug: string;
}
const SESSION_OWNER = new Map<string, SessionOwner>();

// When was a session first stored? Used to give freshly-created sessions
// a grace period during which we DON'T treat probe failures as "dead".
// A new pod can take 5-8 min to finish its prebake (clone + npm ci × 3
// + nix build) before port 8888 opens. During that window, every probe
// sees "could not connect to backend sandbox" — a transient state, not
// session death. Without a grace period, every sandbox-repo-setup call
// during prebake evicts the cache and creates a NEW claim, causing
// runaway claim-creation storms.
const SESSION_CREATED_AT = new Map<string, number>();

// Template name the session was created with. Used by sandbox-repo-setup
// on reuse to confirm the cached session is the right template type.
// Without this we fall back to a fragile substring-on-session-id check
// (cached.id.includes("agent-workspace") || ...) which fails for new
// templates like hyperswitch-workspace-template — kata-claim-* IDs don't
// encode the template name, so the check evicts perfectly good sessions
// and spawns duplicate claims.
const SESSION_TEMPLATE = new Map<string, string>();
// Sessions younger than this are considered "still warming up" — probe
// failures during this window get retried/ignored instead of triggering
// eviction. Matches the SandboxTemplate's prebake budget (~8 min).
const SESSION_FRESH_WINDOW_MS = 8 * 60 * 1000;

// Session ids that are intentionally SHARED across users/conversations and so
// must bypass the per-conversation ownership check. Currently only the single
// read-only sbx-git session (see resolveSbxGit). Safe because such sessions are
// read-only: the write/exec tools are stripped from the palette for the runs
// that use them, so cross-tenant sharing can't mutate anything.
const SHARED_SESSIONS = new Set<string>();

// Session ids that are READ-ONLY (sbx-git). Any exec/write against them is
// enforced here at execution time — not only by removing the tool from the
// palette — so an explicit sessionId, a bypassed tool-strip, or a dev agent
// reusing the shared session still cannot mutate it. sandbox-run only permits
// the read-only command allowlist below; write/destroy are rejected outright.
const READONLY_SESSIONS = new Set<string>();

// Binaries that are read-only REGARDLESS of their arguments (no write/exec
// capability; redirection + command-chaining are blocked separately below).
// Deliberately EXCLUDES find/sed/awk/git/xargs/interpreters — agents use the
// dedicated read/grep/find tools, and `git-read` for any git (its own allowlist).
const READONLY_CMD_ALLOW = new Set([
  "cat", "ls", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "nl", "tac",
  "rev", "grep", "egrep", "fgrep", "rg", "diff", "comm", "column", "basename",
  "dirname", "pwd", "echo", "printf", "file", "stat", "tree", "jq", "yq",
  "readlink", "realpath",
]);
// Block redirection (`>`), pipes (`|`), chaining (`;`/`&&`), and subshells
// (`$(`/backtick) so a single whitelisted binary can't be turned into a write.
const READONLY_SHELL_META = /[;&|`$(){}<>\n\r]/;

/** True only for a single whitelisted read-only command (no chaining/redirection). */
function isReadOnlyCommand(cmd: string): boolean {
  const t = (cmd ?? "").trim();
  if (!t || READONLY_SHELL_META.test(t)) return false;
  const bin = t.split(/\s+/)[0]?.replace(/^.*\//, ""); // basename of the binary
  return !!bin && READONLY_CMD_ALLOW.has(bin);
}

const READONLY_REJECT_RUN =
  "Error: This is the READ-ONLY git sandbox (sbx-git). `sandbox-run` only allows read-only commands here " +
  `(${[...READONLY_CMD_ALLOW].slice(0, 12).join(", ")}, …) with no pipes/redirection/chaining. ` +
  "Use the dedicated read/grep/find tools for inspection, and the `git-read` tool for any git " +
  "(read a branch by ref — never checkout). To write or build, the run must use a per-project dev sandbox.";

/** Reject any mutating op against a read-only (sbx-git) session. Returns an error string, or null if allowed. */
function readOnlyGuard(session: Session, opts: { command?: string; write?: boolean; destroy?: boolean }): string | null {
  if (!READONLY_SESSIONS.has(session.id)) return null;
  if (opts.write) return "Error: cannot write files in the read-only sbx-git sandbox.";
  if (opts.destroy) return "Error: refusing to destroy the shared read-only sbx-git sandbox.";
  if (opts.command !== undefined && !isReadOnlyCommand(opts.command)) return READONLY_REJECT_RUN;
  return null;
}

// Narrow set of destructive command patterns blocked on the sandbox shell path.
// Enforced at the execute() chokepoint below, so it fires on every sandbox-run
// path regardless of which agent framework dispatched the call.
const DESTRUCTIVE_SANDBOX_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\brm\s+-\w*r\w*(?:\s+-\S+)*\s+(?:\/|~|\$HOME|\.\.)(?:\s|\/|\*|$)/, label: "recursive rm of /, ~, $HOME or .." },
  { pattern: /\bgit\s+push\b[^\n]*--force(?!-with-lease)\b/, label: "git push --force" },
  { pattern: /\bgit\s+push\b[^\n]*\s-f(?=\s|$)/, label: "git push -f" },
  { pattern: /\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/, label: "curl | sh" },
  { pattern: /\bwget\b[^\n|]*\|\s*(?:ba)?sh\b/, label: "wget | sh" },
  { pattern: /\bnpm\s+publish\b/, label: "npm publish" },
  { pattern: /\bmkfs\b/, label: "mkfs" },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\//, label: "dd to device" },
  { pattern: /:\s*\(\s*\)\s*\{\s*:/, label: "fork bomb" },
  { pattern: />\s*\/dev\/(?:sd|nvme|disk)/, label: "write to disk device" },
];

/** Reject an obviously-destructive sandbox command. Returns an error string, or null if allowed. */
function destructiveCommandGuard(cmd: string | undefined): string | null {
  if (!cmd) return null;
  for (const { pattern, label } of DESTRUCTIVE_SANDBOX_PATTERNS) {
    if (pattern.test(cmd)) {
      return (
        `Error: command blocked by the sandbox safety guard ("${label}"). ` +
        "This pattern is not allowed. Narrow it (target a specific subdirectory, " +
        "use `git push --force-with-lease` instead of `--force`, avoid piping remote " +
        "scripts into a shell) and retry."
      );
    }
  }
  return null;
}

const STALE_PATTERNS = [
  /could not connect to the backend sandbox/i,
  /HTTP request failed/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /sandbox(?:claim)?.*not found/i,
];

// Agents whose per-thread session is ISOLATED PER USER rather than shared
// across the thread. The Digital Twin runs AS a specific mentioned user, so two
// users mentioned in ONE Spaces thread each need a private session/sandbox
// (otherwise user B's mention resumes user A's twin conversation). Everything
// else keeps the intentional shared-thread resume documented below.
const PER_USER_SESSION_AGENTS: ReadonlySet<string> = new Set(["digital-twin"]);

// Fold a userId into a key segment using the archive-safe charset only
// (`[A-Za-z0-9-]`; `_` is reserved as the `<cid>_<slug>` separator and `:` is
// banned by claw's isSafeId). Length-capped so the composite store key stays
// within the GCS archive-key validator (/^[A-Za-z0-9_-]{8,100}$/). userIds here
// are cuid-shaped, so this is a guard, not a hot path.
function safeUserKeySegment(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9]/g, "");
  return cleaned.length <= 40 ? cleaned : cleaned.slice(0, 40);
}

export function buildSandboxStoreKey(userId: string | undefined, conversationId: string | undefined, agentSlug?: string | undefined): string | undefined {
  // Default: keyed by conversation + agent ONLY — userId is NOT part of the key.
  // A thread's session/sandbox is SHARED across every user in that thread for
  // the same agent, so a second user triggering the agent RESUMES the existing
  // session (conversation context + tool calls preserved) instead of starting
  // fresh ("claude --resume", not a new session). Per-user visibility is
  // enforced at the UI layer (Agent Control Center ACL filters messages/runs by
  // userId), not by key-level isolation.
  //
  // Exception: PER_USER_SESSION_AGENTS (the Digital Twin) fold the userId INTO
  // the conversation segment so each mentioned user gets a private session in
  // the same thread. `_<slug>` stays LAST so bareConversationIdForStoreKey
  // (lastIndexOf "_") still parses. This is the single chokepoint: every caller
  // that derives the session/sandbox store key inherits the per-user split.
  const cid = conversationId?.trim();
  if (!cid) return undefined;
  const slug = agentSlug?.trim();
  const uid = userId?.trim();
  const cidSeg =
    slug && uid && PER_USER_SESSION_AGENTS.has(slug)
      ? `${cid}-${safeUserKeySegment(uid)}`
      : cid;
  return slug ? `${cidSeg}_${slug}` : cidSeg;
}

export function isStaleSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return STALE_PATTERNS.some((re) => re.test(msg));
}

/**
 * The conversation identity the SANDBOX is keyed by — which is NOT always the
 * conversation the SESSION lives under. Two overrides fold in here, and this is
 * the single chokepoint both `storeKeyFromContext` and `ownerFromContext` read,
 * so the store key and the ownership check can never disagree:
 *
 *   meta.sandboxConversationId — generic explicit override. A run whose session
 *     lives under a synthetic conversation (the PR review room's
 *     `review-room_<sha>`) but which must REUSE the parent run's already-warm
 *     sandbox passes the parent's raw conversationId here. Without it the room
 *     run keys a different, empty sandbox and pays a cold repo setup.
 *   meta.sdlcWikiRun — the original special case, kept verbatim.
 */
export function sandboxConversationIdFromMeta(
  meta: Record<string, string> | undefined,
): string | undefined {
  const override = meta?.["sandboxConversationId"]?.trim();
  if (override) return override;
  const executionId = meta?.["sdlcExecutionId"]?.trim();
  if (meta?.["sdlcWikiRun"] === "true" && executionId) return `chat-sdlc-wiki-${executionId}`;
  return meta?.["conversationId"]?.trim();
}

function ownerFromContext(context: { meta?: Record<string, string> } | undefined): SessionOwner | undefined {
  const userId = context?.meta?.["userId"]?.trim();
  const conversationId = sandboxConversationIdFromMeta(context?.meta);
  if (!userId || !conversationId) return undefined;
  return {
    userId,
    conversationId,
    agentSlug: context?.meta?.["agentSlug"]?.trim() ?? "",
  };
}

function storeKeyFromContext(context: { meta?: Record<string, string> } | undefined): string | undefined {
  return buildSandboxStoreKey(
    context?.meta?.["userId"],
    sandboxConversationIdFromMeta(context?.meta),
    context?.meta?.["agentSlug"],
  );
}

const EXPERIMENT_IDLE_SLACK_MS = 20 * 60_000;
const EXPERIMENT_IDLE_FLOOR_MS = 30 * 60_000;
const EXPERIMENT_IDLE_CAP_MS = 3 * 60 * 60_000;

export function experimentIdleTimeoutMs(ctx: ToolExecutionContext): number | undefined {
  const raw = ctx.meta?.["experimentDeadlineAt"];
  if (!raw) return undefined;
  const deadlineMs = Date.parse(raw);
  if (!Number.isFinite(deadlineMs)) return undefined;
  const wantedMs = deadlineMs - Date.now() + EXPERIMENT_IDLE_SLACK_MS;
  return Math.min(EXPERIMENT_IDLE_CAP_MS, Math.max(EXPERIMENT_IDLE_FLOOR_MS, wantedMs));
}

function idleTimeoutForSessionCreation(
  context: ToolExecutionContext,
  explicitIdleTimeoutMs: number | undefined,
  fallbackIdleTimeoutMs: number,
): number {
  if (explicitIdleTimeoutMs !== undefined) return explicitIdleTimeoutMs;
  const experimentIdleMs = experimentIdleTimeoutMs(context);
  if (experimentIdleMs !== undefined) {
    sandboxLog.info(
      `[sandbox] applying experiment idle timeout default: ${Math.ceil(experimentIdleMs / 60_000)} min`,
      { experimentIdleTimeoutMs: experimentIdleMs },
    );
    return experimentIdleMs;
  }
  return fallbackIdleTimeoutMs;
}

const AUTH_URL_DEFAULT = "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003";

/** POST to the experiment control plane. Best-effort by design: a control-plane
 * outage must never fail the sandbox tool whose real work already succeeded.
 * No-ops when the run isn't an experiment. */
async function postToExperiment(
  context: ToolExecutionContext,
  suffix: string,
  payload: Record<string, unknown>,
  logContext: Record<string, unknown>,
): Promise<void> {
  const experimentId = context.meta?.["experimentId"]?.trim();
  if (!experimentId) return;

  const authUrl = (
    context.config["XYNE_CLAW_AUTH_URL"] ??
    process.env["XYNE_CLAW_AUTH_URL"] ??
    AUTH_URL_DEFAULT
  ).replace(/\/+$/, "");
  const s2sKey =
    context.s2sKey ??
    context.config["XYNE_CLAW_S2S_KEY"] ??
    process.env["XYNE_CLAW_S2S_KEY"] ??
    "";

  const warn = (error: string) =>
    sandboxLog.warn(`[sandbox] experiment ${suffix} report failed; continuing`, { experimentId, ...logContext, error });

  if (!s2sKey) {
    warn("XYNE_CLAW_S2S_KEY is unavailable");
    return;
  }

  try {
    const response = await fetch(
      `${authUrl}/claw/api/v1/internal/experiments/${encodeURIComponent(experimentId)}${suffix}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-s2s-key": s2sKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) warn(`HTTP ${response.status}`);
  } catch (err) {
    warn(redactSecrets(err instanceof Error ? err.message : String(err)));
  }
}

/** Persist an experiment's newly-created sandbox id outside the ephemeral claw
 * process, so a later epoch can reuse the sandbox instead of spawning another. */
async function reportExperimentSandboxCreated(
  context: ToolExecutionContext,
  session: Session,
  template: string,
): Promise<void> {
  const epoch = context.meta?.["experimentEpoch"]?.trim() || "unknown";
  await postToExperiment(
    context,
    "/sandbox-note",
    { note: `sandboxId=${session.id} template=${template} createdAtEpoch=${epoch}` },
    { sandboxId: session.id },
  );
}

/** Register files that actually reached the thread. The control plane gates
 * `proved` on this list — proof left inside a sandbox dies with the sandbox. */
async function reportExperimentDelivery(
  context: ToolExecutionContext,
  filenames: string[],
): Promise<void> {
  if (filenames.length === 0) return;
  await postToExperiment(context, "/delivered", { filenames }, { filenames: filenames.length });
}

function rememberSession(storeKey: string | undefined, session: Session, template?: string, owner?: SessionOwner): void {
  if (storeKey) SESSION_STORE.set(storeKey, session);
  SESSION_STORE.set(session.id, session);
  const now = Date.now();
  if (storeKey) SESSION_CREATED_AT.set(storeKey, now);
  SESSION_CREATED_AT.set(session.id, now);
  if (owner) {
    if (storeKey) SESSION_OWNER.set(storeKey, owner);
    SESSION_OWNER.set(session.id, owner);
  }
  if (template) {
    if (storeKey) SESSION_TEMPLATE.set(storeKey, template);
    SESSION_TEMPLATE.set(session.id, template);
  }
}

function isSessionOwnedByContext(session: Session, lookupKey: string | undefined, context: { meta?: Record<string, string> } | undefined): boolean {
  // Shared read-only sessions (sbx-git) are accessible to any caller — they hold
  // no per-tenant state and expose no mutating tools.
  if (SHARED_SESSIONS.has(session.id)) return true;
  const owner =
    (lookupKey ? SESSION_OWNER.get(lookupKey) : undefined) ??
    SESSION_OWNER.get(session.id);
  const caller = ownerFromContext(context);
  if (!owner || !caller) return false;
  // Match the SAME identity buildSandboxStoreKey uses, or the two disagree.
  // That key deliberately EXCLUDES userId (a thread's sandbox is shared by every
  // user in that thread for the same agent), so comparing userId here locked out
  // every participant except whoever happened to create the session: the lookup
  // hands you a thread-shared session and this check then refuses it.
  // Observed 2026-08-25 on credit-doctor — a second user in the thread could not
  // run, destroy, or recreate the sandbox; every recovery path returned
  // "not authorized for this user/conversation", including sandbox-destroy, so
  // the thread could not be unwedged by anyone but the original caller.
  // userId is part of the identity only for PER_USER_SESSION_AGENTS, which are
  // exactly the agents whose store key folds userId in.
  const perUserAgent = !!caller.agentSlug && PER_USER_SESSION_AGENTS.has(caller.agentSlug);
  if (perUserAgent && owner.userId !== caller.userId) return false;
  return owner.conversationId === caller.conversationId &&
    owner.agentSlug === caller.agentSlug;
}

function unauthorizedSessionMessage(sessionId: string): string {
  return `Error: Session ${sessionId} is not authorized for this user/conversation.`;
}

function isFreshSession(session: Session, storeKey?: string): boolean {
  const t = (storeKey ? SESSION_CREATED_AT.get(storeKey) : undefined) ??
            SESSION_CREATED_AT.get(session.id);
  if (!t) return false;
  return Date.now() - t < SESSION_FRESH_WINDOW_MS;
}

function evictSession(session: Session, storeKey?: string): void {
  if (storeKey) {
    SESSION_STORE.delete(storeKey);
    SESSION_CREATED_AT.delete(storeKey);
    SESSION_OWNER.delete(storeKey);
    SESSION_TEMPLATE.delete(storeKey);
  }
  SESSION_STORE.delete(session.id);
  SESSION_CREATED_AT.delete(session.id);
  SESSION_OWNER.delete(session.id);
  SESSION_TEMPLATE.delete(session.id);
  for (const [k, v] of SESSION_STORE.entries()) {
    if (v === session) {
      SESSION_STORE.delete(k);
      SESSION_CREATED_AT.delete(k);
      SESSION_OWNER.delete(k);
      SESSION_TEMPLATE.delete(k);
    }
  }
}

// Probe a session for liveness. Two safeguards against false-positive
// "dead" verdicts that cause claim-creation storms:
//   1. If the session is fresh (< SESSION_FRESH_WINDOW_MS old), skip the
//      probe entirely and assume alive — the pod is still warming up.
//   2. Otherwise retry up to 3× with exponential backoff before
//      declaring dead. A single transient sandbox-router blip or
//      network glitch shouldn't trigger eviction.
async function probeSession(session: Session, storeKey?: string): Promise<boolean> {
  if (isFreshSession(session, storeKey)) return true;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await session.commands.run("true", 5_000);
      return true;
    } catch (err) {
      lastErr = err;
      if (!isStaleSessionError(err)) return true;          // non-stale error: don't evict
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
  }
  // 3 stale errors in a row; treat as dead.
  return false;
}

export function getSandboxSession(storeKey: string): Session | undefined {
  return SESSION_STORE.get(storeKey);
}

/** Remove run-bound Git credential material without destroying reusable sandboxes. */
export async function cleanupSdlcSandboxCredentialsForContext(
  context: ToolExecutionContext,
): Promise<void> {
  const cleaned = new Set<Session>();
  for (const [lookupKey, session] of SESSION_STORE.entries()) {
    if (
      cleaned.has(session) ||
      READONLY_SESSIONS.has(session.id) ||
      !isSessionOwnedByContext(session, lookupKey, context)
    ) {
      continue;
    }
    cleaned.add(session);
    await cleanupSdlcGitCredentialMaterial(session).catch(() => undefined);
  }
}

export { probeSession };

export interface HealthCheck {
  cmd: string;
  // "all-healthy" — every line of `cmd`'s stdout starts with "Up" or
  //   contains "healthy" (docker ps style; legacy kata path).
  // "all-up"      — `cmd` outputs the literal string "all-up" on stdout
  //   when ports are bound; otherwise prints `MISSING:<port>` lines
  //   (Nix process-compose path; agent-workspace).
  successCondition: "all-healthy" | "all-up";
  intervalMs: number;
  timeoutMs: number;
}

export type SetupStep =
  | { type: "install"; packages: string[]; cmd?: string }
  // services/devserver: if `markerPath` is set and the file exists in the
  // sandbox, the launch is skipped (the prebake already started this).
  // healthCheck still runs so the caller knows the dependency is ready.
  | { type: "services"; cmd: string; healthCheck?: HealthCheck; markerPath?: string }
  | { type: "devserver"; name: string; cmd: string; cwd: string; markerPath?: string }
  | { type: "run"; label: string; cmd: string; cwd?: string; timeoutMs?: number };

// Auxiliary repos baked into a sandbox template alongside the primary
// repo. Each entry's branch is independently overridable at claim time
// via the tool's `auxBranches` input. Currently used by the hyperswitch
// template (primary: hyperswitch; aux: prism, control-center, web).
export interface AuxRepo {
  name: string;          // stable key the agent references (e.g. "prism")
  url: string;           // origin URL (for reference; clones live in the image)
  defaultBranch: string;
  workDir: string;       // path inside the pod
}

export interface RepoSetupConfig {
  slug: string;
  name: string;
  description: string;
  /** Omit for a no-repo profile (e.g. "Browser (no repo)"): no clone happens,
   *  the sandbox is just provisioned on `template`. */
  repoUrl?: string;
  defaultBranch: string;
  cloneDepth?: number;
  /** Git partial-clone filter. Wiki sandboxes use blobless history so old
   *  source is fetched lazily instead of cloning every historical blob. */
  cloneFilter?: "blob:none" | "tree:0";
  cloneSingleBranch?: boolean;
  cloneTimeoutMs?: number;
  workDir: string;
  template: string;
  sessionTimeoutMs?: number;
  idleTimeoutMs?: number;
  readyTimeoutMs?: number;
  /** Session lifetime for an ON-DEMAND write sandbox (sandbox-repo-setup
   *  write:true). Keep this short for hot repos (e.g. xyne-spaces = 20 min) so
   *  few golden-snapshot clones are alive at once and the per-snapshot GCP
   *  op-rate limit isn't tripped. Falls back to sessionTimeoutMs when unset, so
   *  other repos' behavior is unchanged. */
  writeSessionTimeoutMs?: number;
  /** Idle timeout for an ON-DEMAND write sandbox — it's destroyed after this
   *  much inactivity (e.g. xyne-spaces = 10 min), independent of the hard
   *  writeSessionTimeoutMs cap. Falls back to idleTimeoutMs when unset, so other
   *  repos are unchanged. */
  writeIdleTimeoutMs?: number;
  /** READ-FIRST: when true, sandbox-repo-setup DEFAULTS every interactive run
   *  to the read-only sbx-git sandbox (no snapshot clone), and only claims a
   *  writable golden dev sandbox on explicit write:true. Opt-in per repo — set
   *  it on hot repos (e.g. xyne-spaces) to eliminate default snapshot clones.
   *  Repos WITHOUT this keep legacy behavior (setup provisions a writable clone
   *  directly). Requires the repo to exist in SBX_GIT.repoPaths for reads. */
  readFirst?: boolean;
  steps: SetupStep[];
  ports?: Record<string, number>;
  // When the template bakes multiple repos, list the auxiliary ones here.
  // The tool input schema then gains `auxBranches: Record<name, branch>`
  // letting the agent override branches on these repos at claim time.
  auxRepos?: AuxRepo[];
  /** Generic repositories are not baked into their template. Skip the golden
   * clone probe and clone them immediately. */
  skipBakedCloneWait?: boolean;
  /** Durable binding used to mint a fresh one-use envelope for each sandbox bootstrap. */
  runtimeCredentialBinding?: SdlcRuntimeCredentialBinding;
}

export function buildRepoCloneCommand(
  config: RepoSetupConfig,
  baseBranch: string,
): string {
  if (!config.repoUrl) {
    throw new Error("Repository URL is required for clone");
  }

  return [
    "git clone",
    config.cloneDepth ? `--depth ${config.cloneDepth}` : "",
    config.cloneFilter ? `--filter=${config.cloneFilter}` : "",
    config.cloneSingleBranch ? "--single-branch" : "",
    `--branch ${baseBranch}`,
    config.repoUrl,
    config.workDir,
  ]
    .filter(Boolean)
    .join(" ");
}

export const SANDBOX_CONFIG_SCHEMA = {
  KATA_ROUTER_URL: {
    label: "Kata Router URL",
    default: "",
    required: true as const,
    placeholder: "http://sandbox-router-svc.xyne-apps.svc.cluster.local:8080",
  },
  KATA_NAMESPACE: {
    label: "Kata Namespace",
    default: "xyne-apps",
    required: true as const,
    placeholder: "xyne-apps",
  },
  KATA_TEMPLATE: {
    label: "Kata Sandbox Template",
    // Unchanged default. Browser work routes to `agent-workspace-browser-template`
    // (via the "Browser (no repo)" pin); repo work routes to a repo template (via
    // the pin). See pinnedTemplateForContext + repo-configs.ts.
    default: "kata-workspace-template",
    required: false as const,
    placeholder: "kata-workspace-template",
  },
};

function makeClient(config: Record<string, string>, templateOverride?: string): KataClient {
  const routerUrl = config["KATA_ROUTER_URL"];
  if (!routerUrl) throw new Error("KATA_ROUTER_URL is required");
  return new KataClient({
    routerUrl,
    namespace: config["KATA_NAMESPACE"] || "xyne-apps",
    // Precedence: explicit override (e.g. a UI-pinned repo's template) >
    // agent-config KATA_TEMPLATE > the previous default. Browser/repo sandboxes
    // come through the pin (templateOverride).
    template: templateOverride || config["KATA_TEMPLATE"] || "kata-workspace-template",
  });
}

/**
 * When an agent has a sandbox pinned in the UI (agent.config.sandboxRepo →
 * context.meta.sandboxRepo), EVERY auto-provisioned sandbox must use that repo's
 * template — never the legacy kata image and never an LLM-chosen override. This
 * makes `sandbox-create` / `sandbox-run` one-shot behave like `sandbox-repo-setup`
 * w.r.t. template selection. Returns the pinned repo's template, or undefined
 * when no pin is set (callers then fall back to an explicit param / the default).
 */
async function pinnedTemplateForContext(context: ToolExecutionContext): Promise<string | undefined> {
  const pinnedRepo = context.meta?.["sandboxRepo"]?.trim();
  if (!pinnedRepo) return undefined;
  const { REPO_CONFIGS } = await import("./repo-configs.js");
  return REPO_CONFIGS[pinnedRepo]?.template;
}

/**
 * Create a persistent sandbox session. Returns a sessionId for follow-up tool calls.
 */
export const sandboxCreate: ToolDefinition = {
  slug: "sandbox-create",
  name: "Sandbox Create Session",
  description:
    "Create a persistent isolated Kata/QEMU microVM sandbox session for multi-step workflows. " +
    "Provides clean, isolated environment for development tasks. Returns sessionId. " +
    "Use sandbox-run / sandbox-run-detached to execute commands, sandbox-write-file to upload files, " +
    "and sandbox-destroy when done.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      timeoutMs: {
        type: "number",
        description: "Session lifetime in milliseconds before auto-destruction (default: 3600000 = 1 hour)",
      },
      idleTimeoutMs: {
        type: "number",
        description: "Idle timeout in milliseconds — session auto-destroys after this much inactivity (default: 600000 = 10 min)",
      },
      template: {
        type: "string",
        description: "Sandbox template name to use (default: kata-workspace-template). For browser automation pin the agent to 'Browser (no repo)'; for repo work pin to a repo. Only override here for special cases.",
      },
    },
    required: [],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const storeKey = storeKeyFromContext(context);
    if (!storeKey) return "Error: No userId/conversationId in context.";
    const timeoutMs = (params["timeoutMs"] as number | undefined) ?? 60 * 60 * 1000;
    const idleTimeoutMs = idleTimeoutForSessionCreation(
      context,
      params["idleTimeoutMs"] as number | undefined,
      10 * 60 * 1000,
    );
    // A UI-pinned sandbox repo wins over whatever template the LLM passed —
    // a pinned agent must always get its own sandbox, never the legacy kata one.
    const pinnedTemplate = await pinnedTemplateForContext(context);
    const requestedTemplate = pinnedTemplate ?? (params["template"] as string | undefined);
    // ROTATE, exactly as the repo-setup path does. Without this, every
    // sandbox-create on a pinned agent clones the BASE template's single
    // snapshot: pinnedTemplateForContext returns REPO_CONFIGS[repo].template,
    // which is deliberately the base name (ROTATION_SETS is KEYED by it), so
    // skipping rotation concentrates every claim on one GCP snapshot and trips
    // its per-source op-rate limit. Measured 2026-08-25: agent-workspace and
    // xyne-cli both stormed with RESOURCE_OPERATION_RATE_EXCEEDED and ~35
    // Pending pods cluster-wide, while the four a/b/c/d rotation pools sat
    // absorbing nothing. rotateTemplate() returns non-rotated templates
    // unchanged, so this is a no-op for every template without a rotation set.
    const template = requestedTemplate ? rotateTemplate(requestedTemplate) : requestedTemplate;

    const existing = SESSION_STORE.get(storeKey);
    if (existing) {
      if (!isSessionOwnedByContext(existing, storeKey, context)) {
        return "Error: Existing sandbox session is not authorized for this user/conversation.";
      }
      const alive = await probeSession(existing, storeKey);
      if (alive) {
        return JSON.stringify({ sessionId: existing.id, status: "ready", reused: true });
      }
      evictSession(existing, storeKey);
    }

    try {
      const client = makeClient(context.config, template);
      const session = await client.createSession({ timeoutMs, idleTimeoutMs, ...(template ? { template } : {}) });
      rememberSession(storeKey, session, template, ownerFromContext(context));
      await reportExperimentSandboxCreated(
        context,
        session,
        template ?? context.config["KATA_TEMPLATE"] ?? "kata-workspace-template",
      );
      return JSON.stringify({ sessionId: session.id, status: "ready" });
    } catch (err) {
      return sandboxErr(err);
    }
  },
};

/**
 * Run a command in a sandbox. Auto-detects session or runs one-shot.
 */
export const sandboxRun: ToolDefinition = {
  slug: "sandbox-run",
  name: "Sandbox Run Command",
  description:
    "**PREFERRED** for SHORT commands: run shell commands in an isolated Kata/QEMU microVM sandbox. " +
    "Use this instead of bash for better isolation, safety, and clean environment. " +
    "Ideal for greps, file reads/edits, git status/log/diff, and any command that finishes in well under 60s. " +
    "BATCH related steps into ONE call (chain with && or ;) — each call costs a full model round-trip, so " +
    "many single-line calls are the dominant cost of a long sandbox session. " +
    "DO NOT use it for long work — installs (pnpm/npm/yarn add|install), builds, tsc typechecks, and test " +
    "suites routinely exceed the timeout (default 60000ms). This call is SYNCHRONOUS: when the timeout is " +
    "hit the call returns an error, the work is abandoned, and re-running the same command just burns the " +
    "timeout again. For anything that may take more than ~60s use sandbox-run-detached + sandbox-poll-job. " +
    "Auto-detects existing sessions or creates fresh sandboxes as needed.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Optional session ID. If omitted, auto-resolves from conversation context or runs one-shot.",
      },
      cmd: {
        type: "string",
        description:
          "Shell command to execute. BATCH related steps into ONE call — every invocation costs a full " +
          "model round-trip (~5-10s), so 20 one-line calls waste minutes versus a single chained command. " +
          "Chain with && (stop on first failure) or ; (always continue), use a heredoc for multi-line " +
          "scripts, and echo section markers so you can read one combined output, e.g. " +
          "`cd /workspace/repo && echo '== branch ==' && git branch --show-current && echo '== status ==' && git status --short`. " +
          "Only split into separate calls when a later step genuinely depends on reading the earlier output first.",
      },
      timeoutMs: {
        type: "number",
        description: "Command timeout in milliseconds (default: 60000). On timeout the call returns an error and the work is abandoned — raise this only for commands you are confident finish sooner; otherwise use sandbox-run-detached.",
      },
    },
    required: ["cmd"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const cmd = (params["cmd"] ?? params["command"]) as string;
    const timeoutMs = (params["timeoutMs"] as number | undefined) ?? 60_000;
    if (!cmd?.trim()) return "Error: cmd or command is required.";
    const destructive = destructiveCommandGuard(cmd);
    if (destructive) return destructive;

    // Try explicit sessionId first
    const explicitSessionId = params["sessionId"] as string | undefined;
    let replacedDeadSession: string | null = null;
    if (explicitSessionId) {
      const session = SESSION_STORE.get(explicitSessionId);
      if (!session) return `Error: Session ${explicitSessionId} not found.`;
      if (!isSessionOwnedByContext(session, explicitSessionId, context)) {
        return unauthorizedSessionMessage(explicitSessionId);
      }
      const roExplicit = readOnlyGuard(session, { command: cmd });
      if (roExplicit) return roExplicit;

      try {
        const result = await session.commands.run(cmd, timeoutMs);
        return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      } catch (err) {
        if (isStaleSessionError(err)) {
          evictSession(session);
          replacedDeadSession = explicitSessionId;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          if (/aborted due to timeout|operation was aborted/i.test(msg)) {
            return `Error: Command exceeded the ${timeoutMs}ms sandbox-run timeout and was abandoned (the VM is still alive; the command may still be running). Do NOT just retry the same command with sandbox-run — it will time out again. Re-run it with sandbox-run-detached and poll with sandbox-poll-job, or pass a larger timeoutMs if you are sure it finishes sooner. DO NOT attempt to destroy the session.`;
          }
          return `Error: ${redactSecrets(msg)}`;
        }
      }
    }

    // Try auto-resolve from conversation context
    const conversationId = context.meta?.["conversationId"];
    const storeKey = storeKeyFromContext(context);
    if (conversationId && !replacedDeadSession) {
      const session = storeKey ? SESSION_STORE.get(storeKey) : undefined;
      if (session) {
        if (!isSessionOwnedByContext(session, storeKey, context)) {
          return unauthorizedSessionMessage(session.id);
        }
        const roStore = readOnlyGuard(session, { command: cmd });
        if (roStore) return roStore;
        try {
          const result = await session.commands.run(cmd, timeoutMs);
          return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
        } catch (err) {
          if (isStaleSessionError(err)) {
            evictSession(session, storeKey);
            replacedDeadSession = session.id;
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            if (/aborted due to timeout|operation was aborted/i.test(msg)) {
              return `Error: Command exceeded the ${timeoutMs}ms sandbox-run timeout and was abandoned (the VM is still alive; the command may still be running). Do NOT just retry the same command with sandbox-run — it will time out again. Re-run it with sandbox-run-detached and poll with sandbox-poll-job, or pass a larger timeoutMs if you are sure it finishes sooner. DO NOT attempt to destroy the session.`;
            }
            return `Error: ${redactSecrets(msg)}`;
          }
        }
      }
    }

    // No session found — fall back to one-shot. Honour a UI-pinned sandbox repo
    // so the ephemeral VM uses the pinned template (with /services + browser),
    // never the legacy kata default.
    try {
      const pinnedTemplate = await pinnedTemplateForContext(context);
      // Rotate here too — a one-shot exec still provisions a VM from the
      // template's snapshot, so an un-rotated base name concentrates clones
      // the same way sandbox-create did.
      const oneShotTemplate = pinnedTemplate ? rotateTemplate(pinnedTemplate) : pinnedTemplate;
      const client = makeClient(context.config, oneShotTemplate);
      const result = await client.exec(cmd, { timeoutMs });
      return redactAndStringify({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ...(replacedDeadSession
          ? {
              note: `Previous sandbox session ${replacedDeadSession} was dead (pod replaced); this command ran on a fresh one-shot VM from the pinned template. Repo state is the template baseline — if you need a specific branch or the services running, call sandbox-repo-setup once and reuse the session it returns.`,
            }
          : {}),
      });
    } catch (err) {
      if (replacedDeadSession) {
        return `Error: Sandbox session ${replacedDeadSession} was dead (pod replaced) and the fallback one-shot VM also failed: ${sandboxErr(err)}`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Fire-and-forget: run a command in the background, returns a jobId to poll.
 */
export const sandboxRunDetached: ToolDefinition = {
  slug: "sandbox-run-detached",
  name: "Sandbox Run Detached",
  description:
    "**USE THIS FOR ANY LONG COMMAND (>~60s).** Starts the command in the background inside a sandbox " +
    "session and returns immediately with a jobId; poll it with sandbox-poll-job. This is the correct tool " +
    "for dependency installs (pnpm/npm/yarn add|install), builds, tsc typechecks, lint, and test suites — " +
    "sandbox-run would time out on these and lose the work, while a detached job keeps running to " +
    "completion. Prefer starting the job, doing other useful work, then polling.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      cmd: {
        type: "string",
        description: "Shell command to run in the background",
      },
    },
    required: ["sessionId", "cmd"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const cmd = (params["cmd"] ?? params["command"]) as string;
    const destructive = destructiveCommandGuard(cmd);
    if (destructive) return destructive;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found. Create one with sandbox-create first.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }
    const roDetached = readOnlyGuard(session, { command: cmd });
    if (roDetached) return roDetached;

    try {
      const jobId = await session.commands.runDetached(cmd);
      return JSON.stringify({ jobId });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Poll the status of a detached background job.
 */
export const sandboxPollJob: ToolDefinition = {
  slug: "sandbox-poll-job",
  name: "Sandbox Poll Job",
  description: "Check the status of a background job started with sandbox-run-detached. Returns done/stdout/stderr/exitCode.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      jobId: {
        type: "string",
        description: "Job ID returned by sandbox-run-detached",
      },
    },
    required: ["sessionId", "jobId"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const jobId = params["jobId"] as string;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }

    try {
      const status = await session.commands.pollJob(jobId);
      // status shape varies by job state; redact across whatever string fields
      // it carries (stdout/stderr typically).
      return redactAndStringify(status as unknown as Record<string, unknown>);
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Write a file into the sandbox.
 */
export const sandboxWriteFile: ToolDefinition = {
  slug: "sandbox-write-file",
  name: "Sandbox Write File",
  description: "Write a file into an existing sandbox session. Creates parent directories as needed.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      path: {
        type: "string",
        description: "Absolute path inside the sandbox (e.g. /workspace/script.py)",
      },
      content: {
        type: "string",
        description: "File content as a UTF-8 string for text files, or base64-encoded string for binary files",
      },
      encoding: {
        type: "string",
        enum: ["utf8", "base64"],
        description: "Encoding of content. Use 'base64' for binary files, 'utf8' (default) for text.",
      },
    },
    required: ["sessionId", "path", "content"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const path = params["path"] as string;
    const content = params["content"] as string;
    const encoding = (params["encoding"] as string | undefined) ?? "utf8";

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }
    const roWrite = readOnlyGuard(session, { write: true });
    if (roWrite) return roWrite;

    try {
      const buf = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
      await session.files.write(path, buf);
      return JSON.stringify({ path, written: true });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Surgical string-replace edit — the revision fast path. Without it every
 * design/code revision re-emits the ENTIRE file through sandbox-write-file
 * (tens of thousands of tokens for one changed line, minutes of decode).
 * Same contract as claw's own Edit tool: oldString must match exactly once
 * unless replaceAll, so a bad match can never silently corrupt the file.
 */
export const sandboxEditFile: ToolDefinition = {
  slug: "sandbox-edit-file",
  name: "Sandbox Edit File",
  description:
    "Edit an existing text file in the sandbox by exact string replacement — MUCH faster than rewriting the whole file with sandbox-write-file. " +
    "oldString must appear exactly once in the file (or pass replaceAll: true). Include enough surrounding context to make it unique.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      path: {
        type: "string",
        description: "Absolute path inside the sandbox (e.g. /workspace/design.html)",
      },
      oldString: {
        type: "string",
        description: "Exact text to replace, including whitespace/indentation. Must match exactly once unless replaceAll.",
      },
      newString: {
        type: "string",
        description: "Replacement text.",
      },
      replaceAll: {
        type: "boolean",
        description: "Replace every occurrence instead of requiring a unique match. Default false.",
      },
    },
    required: ["sessionId", "path", "oldString", "newString"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const path = params["path"] as string;
    const oldString = params["oldString"] as string;
    const newString = params["newString"] as string;
    const replaceAll = params["replaceAll"] === true;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }
    const roWrite = readOnlyGuard(session, { write: true });
    if (roWrite) return roWrite;
    if (!oldString) return "Error: oldString must be non-empty.";
    if (oldString === newString) return "Error: oldString and newString are identical.";

    try {
      const current = (await session.files.read(path)).toString("utf8");
      const count = current.split(oldString).length - 1;
      if (count === 0) {
        return `Error: oldString not found in ${path}. Read the file and copy the exact text (including whitespace).`;
      }
      if (count > 1 && !replaceAll) {
        return `Error: oldString matches ${count} times in ${path}. Add surrounding context to make it unique, or pass replaceAll: true.`;
      }
      const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
      await session.files.write(path, Buffer.from(next, "utf8"));
      return JSON.stringify({ path, replaced: replaceAll ? count : 1 });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Copy a companion file from THIS run's materialized skill directory directly
 * into the sandbox — server-side, so the bytes never round-trip through the
 * model's context (no token cost, no base64 corruption of binaries, no
 * truncation of large scripts). This is the ergonomic path for "a skill ships
 * a script, run it in the sandbox": instead of reading the file into context
 * and re-emitting it through sandbox-write-file, point at the skill file and
 * the runtime streams the bytes across.
 *
 * Confinement: the source is resolved ONLY under this run's session-skills
 * root (`context.meta.skillsRoot`, injected by the claw runtime as
 * `<dataDir>/session-skills/<sessionId>` — the SAME directory the agent's
 * read tools are granted). Absolute inputs and `..` traversal that escape that
 * root are rejected, so this can't read another user's session or arbitrary
 * pod files.
 */
export const sandboxCopyIn: ToolDefinition = {
  slug: "sandbox-copy-in",
  name: "Sandbox Copy Skill File",
  description:
    "Copy a companion file bundled with a loaded skill (a script or asset in the skill's folder) directly into a sandbox session, WITHOUT pasting its content. " +
    "Prefer this over sandbox-write-file when a skill ships a script/binary you need to run in the sandbox: the file is streamed server-side, so large or binary files stay intact and don't bloat context. " +
    "`skillPath` is relative to the skill directory shown in the skill's <location> (e.g. 'sandbox-record-video/scripts/recorder.mjs').",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Sandbox session ID returned by sandbox-create / sandbox-repo-setup",
      },
      skillPath: {
        type: "string",
        description:
          "Path of the skill companion file RELATIVE to this run's session-skills root, e.g. '<skill-slug>/scripts/run.sh'. Leading '/' and '..' are rejected.",
      },
      destPath: {
        type: "string",
        description: "Absolute destination path inside the sandbox (default: /workspace/<basename of skillPath>).",
      },
    },
    required: ["sessionId", "skillPath"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const skillPathRaw = params["skillPath"] as string;
    const destPathRaw = params["destPath"] as string | undefined;

    const skillsRoot = context.meta?.["skillsRoot"];
    if (!skillsRoot) {
      return "Error: No skills are materialized for this run (context.meta.skillsRoot is unset), so there is nothing to copy in. Use sandbox-write-file for ad-hoc content.";
    }
    if (typeof skillPathRaw !== "string" || skillPathRaw.trim().length === 0) {
      return "Error: skillPath must be a non-empty path relative to the skill directory.";
    }

    // Confine the source to THIS run's session-skills root. Reject absolute
    // inputs and any '..' traversal that escapes the root — otherwise this
    // becomes an arbitrary pod-file / cross-session read primitive.
    const rootAbs = resolve(skillsRoot);
    const sourceAbs = resolve(join(rootAbs, skillPathRaw));
    if (sourceAbs !== rootAbs && !sourceAbs.startsWith(rootAbs + sep)) {
      return "Error: skillPath escapes the skill directory. Pass a path relative to the skill folder (no leading '/' and no '..').";
    }
    if (isCredentialPath(sourceAbs)) {
      return JSON.stringify({ error: "Refused: path looks like a credential file" });
    }

    const destPath =
      typeof destPathRaw === "string" && destPathRaw.trim().length > 0
        ? destPathRaw.trim()
        : `/workspace/${sourceAbs.split("/").pop()}`;

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }
    const roWrite = readOnlyGuard(session, { write: true });
    if (roWrite) return roWrite;

    try {
      const buf = await readFile(sourceAbs);
      await session.files.write(destPath, buf);
      return JSON.stringify({ skillPath: skillPathRaw, destPath, bytes: buf.length, copied: true });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return `Error: Skill file not found at '${skillPathRaw}'. Check the path relative to the skill's <location> directory.`;
      }
      return sandboxErr(err);
    }
  },
};

const BINARY_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4",
  pdf: "application/pdf", zip: "application/zip",
};

/**
 * Read a file from the sandbox.
 *
 * Text files: return the content inline.
 * Binary files: return as `[INSPECT:...]` — visible to the agent for
 * self-verification, but NOT delivered to the user. To send a file to the
 * user, use `sandbox-deliver-files`.
 */
export const sandboxReadFile: ToolDefinition = {
  slug: "sandbox-read-file",
  name: "Sandbox Read File",
  description:
    "Read a file from a sandbox session. " +
    "Text files are returned inline. Binary files (images, PDFs, etc.) are loaded into your context for self-inspection ONLY — the user does NOT see them. " +
    "If you want to actually send files to the user, call `sandbox-deliver-files` (it accepts multiple paths in one call).",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      path: {
        type: "string",
        description: "Absolute path inside the sandbox to read",
      },
    },
    required: ["sessionId", "path"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const path = params["path"] as string;
    if (isCredentialPath(path)) {
      return JSON.stringify({ error: "Refused: path looks like a credential file" });
    }

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }

    try {
      const buf = await session.files.read(path);
      const isText = !buf.slice(0, 512).some((b) => b === 0);
      if (isText) {
        // Redact known secret patterns in text-file reads. Catches the obvious
        // exfil paths (sandbox-read-file ~/.ssh/id_rsa, ~/.git-credentials,
        // ~/.npmrc, ~/.netrc, etc.) for the same reasons the sandbox-run
        // redactor exists — defence-in-depth against accidental / unsophisticated
        // leaks; ephemeral creds are the real fix against determined attackers.
        const content = redactSecrets(buf.toString("utf8"));
        return JSON.stringify({ path, content, encoding: "utf8" });
      }
      const fileName = path.split("/").pop() ?? "file";
      const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
      const mimeType = BINARY_MIME[ext] ?? "application/octet-stream";
      // INSPECT marker (not ATTACHMENT) — xyne-claw routes the bytes into the
      // agent's tool-result content for visual self-check but does NOT push
      // to user-facing attachments. This stops the "agent took 12 screenshots
      // for verification → user got 12" leak.
      return `[INSPECT:${fileName}:${mimeType}]\n${buf.toString("base64")}`;
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session);
        return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
      }
      return sandboxErr(err);
    }
  },
};

/**
 * Deliver one or more files from the sandbox to the user as attachments.
 *
 * Use this AFTER inspecting candidates via `sandbox-read-file`. Pass the exact
 * subset of paths you want the user to receive. All files are delivered in a
 * single message attachment list.
 */
export const sandboxDeliverFiles: ToolDefinition = {
  slug: "sandbox-deliver-files",
  name: "Sandbox Deliver Files",
  description:
    "Send one or more files from the sandbox to the user as message attachments. " +
    "Pass the exact paths you want delivered. Use this after inspecting screenshots/PDFs via `sandbox-read-file` to send the relevant subset — the user does NOT see anything you only `sandbox-read-file`.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute paths inside the sandbox to deliver as attachments. Order is preserved.",
        minItems: 1,
      },
    },
    required: ["sessionId", "paths"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const paths = params["paths"] as string[];
    if (!Array.isArray(paths) || paths.length === 0) {
      return "Error: paths must be a non-empty array of absolute file paths.";
    }
    if (paths.some((p) => isCredentialPath(p))) {
      return JSON.stringify({ error: "Refused: path looks like a credential file" });
    }

    const session = SESSION_STORE.get(sessionId);
    if (!session) return `Error: Session ${sessionId} not found.`;
    if (!isSessionOwnedByContext(session, sessionId, context)) {
      return unauthorizedSessionMessage(sessionId);
    }

    const blocks: string[] = [];
    const errors: string[] = [];
    const deliveredNames: string[] = [];
    for (const p of paths) {
      try {
        const buf = await session.files.read(p);
        const fileName = p.split("/").pop() ?? "file";
        deliveredNames.push(fileName);
        const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
        const mimeType = BINARY_MIME[ext] ?? "application/octet-stream";
        blocks.push(`[ATTACHMENT:${fileName}:${mimeType}]\n${buf.toString("base64")}`);
      } catch (err) {
        if (isStaleSessionError(err)) {
          evictSession(session);
          return `Error: Session ${sessionId} died (sandbox pod replaced). Call sandbox-repo-setup to re-provision.`;
        }
        errors.push(`${p}: ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
      }
    }

    if (blocks.length === 0) {
      return `Error: failed to read any of ${paths.length} file(s):\n${errors.join("\n")}`;
    }

    // Only files that actually produced an attachment block are reported —
    // this list is what lets a finding be marked `proved`.
    await reportExperimentDelivery(context, deliveredNames);

    // Concatenate ATTACHMENT blocks. xyne-claw's custom-tools.ts scans for all
    // matches and emits one attachment per block. Trailing error notes are
    // appended for the agent's awareness without breaking the global match.
    const result = blocks.join("\n");
    if (errors.length > 0) {
      return `${result}\n\nNote: ${errors.length} file(s) failed:\n${errors.join("\n")}`;
    }
    return result;
  },
};

/**
 * Set git identity inside the sandbox so every agent commit has the
 * human who triggered the run as AUTHOR and Xyne Spaces as COMMITTER —
 * the standard "person authored it, automation committed it" split. So a
 * commit shows up on Bitbucket with the user's face as author, while the
 * record reflects that it landed via the Xyne Spaces bot.
 *
 *   - Author = context.meta.{userEmail,userName}, which claw populates
 *     from the /run request in routes/run.ts:504-506.
 *   - Committer = Xyne Spaces <noreply@spaces.xyne.juspay.net> (constant).
 *
 * Both are enforced per workdir via a `post-commit` hook (see the big
 * comment below for why `git config` alone can't do it).
 *
 * Idempotent — safe to call on session reuse. If userEmail is missing
 * (older /run callers don't pass it), we no-op and let git use whatever
 * the sandbox image's baked identity is.
 */
async function configureGitIdentity(
  session: Session,
  workDirs: string[],
  userEmail: string | undefined,
  userName: string | undefined,
  log: string[],
): Promise<void> {
  if (!userEmail) {
    log.push("Git identity: userEmail not in context.meta — leaving sandbox defaults.");
    return;
  }
  const safeName = (userName ?? userEmail.split("@")[0] ?? "Xyne User").replace(/['"\\$`]/g, "");
  const safeEmail = userEmail.replace(/['"\\$`]/g, "");

  // Xyne Spaces is the committer of every agent commit; the human stays
  // the author. These come from the same identity previously used for the
  // (now-removed) Co-Authored-By trailer.
  const COMMITTER_NAME = "Xyne Spaces";
  const COMMITTER_EMAIL = "noreply@spaces.xyne.juspay.net";

  // ── The git-env override problem ─────────────────────────────────────
  // The kata sandbox pod sets these container-level env vars (see
  // claw-deployments/kata-infra/10-sandbox-template-gvisor.yaml:219-226):
  //
  //   GIT_AUTHOR_EMAIL = "john.doe@gmail.com"
  //   GIT_AUTHOR_NAME  = "Xyne Workflow Bot"
  //   (same for COMMITTER)
  //
  // Git's precedence is env vars > .git/config, so `git config user.email`
  // alone does NOT change the commit author/committer. Verified blockers
  // (probed 2026-06-03):
  //   • /usr/local/bin is in PATH ahead of /usr/bin BUT root-owned — we
  //     can't drop a wrapper there as nixuser.
  //   • Nix-profile paths come first in PATH but writing there pollutes
  //     the Nix profile (bad practice + may get overwritten).
  //   • kata's /execute endpoint runs commands in non-interactive non-
  //     login bash, so ~/.bashrc / ~/.profile / /etc/profile.d are NOT
  //     sourced — env-export files in those locations don't get picked up.
  //   • session.commands.run sends only {command} — no per-call env.
  //
  // SESSION-LOCAL solution: a `post-commit` hook per repo that runs
  // immediately after every commit, unsets the bad env vars, exports the
  // committer as Xyne Spaces, then re-amends the commit forcing the human
  // user as author via `--author`. The amend's committer comes from the
  // GIT_COMMITTER_* env we just set. Hooks live in `.git/hooks/` inside
  // the per-claim PVC — completely session-local, no system-path writes
  // needed, no permission issues. A re-entry guard (XYNE_POST_COMMIT_
  // AMEND_GUARD env var) prevents the amend's own post-commit from looping.
  //
  // Result: commit lands with the baked bad identity → post-commit amends
  // → final commit has the human user as author and Xyne Spaces as committer.
  const postCommitHook = [
    "#!/bin/sh",
    "# Xyne session-local post-commit identity rewrite.",
    "# Installed by sandbox-repo-setup so the human who triggered the",
    "# agent run is the commit AUTHOR and Xyne Spaces is the COMMITTER,",
    "# overriding the container's baked xyne.spaces/Workflow Bot identity.",
    "# Hook is per-repo, lives in .git/hooks/, and is gone when the",
    "# per-claim PVC is reset.",
    "",
    "# Re-entry guard: the amend below would re-fire this hook and loop.",
    "[ \"$XYNE_POST_COMMIT_AMEND_GUARD\" = \"1\" ] && exit 0",
    "",
    "# Strip the pod-level identity env vars, then set the committer to",
    "# Xyne Spaces. git inherits this env when the amend below runs.",
    "unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL",
    `export GIT_COMMITTER_NAME="${COMMITTER_NAME}"`,
    `export GIT_COMMITTER_EMAIL="${COMMITTER_EMAIL}"`,
    "export XYNE_POST_COMMIT_AMEND_GUARD=1",
    "",
    "# --author forces the human user as author (NOT --reset-author, which",
    "# would copy the committer identity onto the author too). The committer",
    "# comes from GIT_COMMITTER_* above. --no-edit keeps the message intact.",
    // --allow-empty: if the original commit had no file changes (e.g. the
    // doctor's smoke-test empty commit), the amend would otherwise refuse
    // with "would make it empty" and exit 1, silenced by 2>/dev/null. The
    // flag lets the amend rewrite identity on those commits too. stderr is
    // silenced because an amend can fail harmlessly mid-rebase / cherry-pick.
    `git commit --amend --no-edit --no-verify --allow-empty --author="${safeName} <${safeEmail}>" 2>/dev/null || true`,
  ].join("\n");
  const postCommitB64 = Buffer.from(postCommitHook, "utf8").toString("base64");

  for (const dir of workDirs) {
    try {
      // Per-repo, all in one command:
      //   1. Set config (cosmetic, but tools like `git log --format=%an`
      //      of historical commits respect config)
      //   2. Install post-commit hook → fixes author + committer via amend
      const cmd =
        `cd ${dir} && ` +
        `git config user.email "${safeEmail}" && ` +
        `git config user.name "${safeName}" && ` +
        `mkdir -p .git/hooks && ` +
        `echo "${postCommitB64}" | base64 -d > .git/hooks/post-commit && ` +
        `chmod +x .git/hooks/post-commit`;
      await session.commands.run(cmd, 10_000);
      log.push(`Git identity for ${dir}: author ${safeName} <${safeEmail}>, committer ${COMMITTER_NAME} <${COMMITTER_EMAIL}> (post-commit rewrite)`);
    } catch (err) {
      // Non-fatal: failing to set identity shouldn't block the whole
      // setup. The agent can still work; commits just won't be attributed.
      log.push(`Git identity for ${dir}: WARN — ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
    }
  }
}

export function makeRepoSetupTool(config: RepoSetupConfig): ToolDefinition {
  // Build input schema. When the config has auxRepos, add an optional
  // auxBranches field so the agent can override branches on the bundled
  // repos independently of the primary branchName.
  const inputProperties: Record<string, unknown> = {
    branchName: {
      type: "string",
      description: `New branch name to cut (e.g. feat/my-feature). Cut from baseBranch, which defaults to ${config.defaultBranch}.`,
    },
    baseBranch: {
      type: "string",
      description: `Base branch to clone and cut from. Defaults to ${config.defaultBranch} when omitted.`,
    },
    sessionDurationMs: {
      type: "number",
      description: "Session lifetime in milliseconds (default: 3600000 = 1 hour)",
    },
  };
  if (config.auxRepos?.length) {
    const auxNames = config.auxRepos.map((r) => `${r.name} (default ${r.defaultBranch})`).join(", ");
    inputProperties["auxBranches"] = {
      type: "object",
      description:
        `Optional. Override branches for the auxiliary repos bundled in this template. ` +
        `Keys: ${auxNames}. Values: branch name to check out. Example: { "prism": "feat/foo" }. ` +
        `Omitted keys stay on their default branch.`,
      additionalProperties: { type: "string" },
    };
  }
  const tool: ToolDefinition = {
    slug: config.slug,
    name: config.name,
    description: config.description,
    source: "custom:sandbox",
    configSchema: SANDBOX_CONFIG_SCHEMA,
    inputSchema: {
      type: "object",
      properties: inputProperties,
      // No-repo profiles (e.g. "Browser (no repo)") have nothing to branch.
      required: config.repoUrl ? ["branchName"] : [],
    },

    async execute(params, context) {
      if (!context) return "Error: No execution context available.";
      const conversationId = context.meta?.["conversationId"];
      if (!conversationId) return "Error: No conversationId in context.";
      const storeKey = storeKeyFromContext(context);
      if (!storeKey) return "Error: No userId/conversationId in context.";

      // No-repo profile (e.g. "Browser (no repo)") — nothing to clone or build.
      // Ensure a session exists on this profile's template (browser-only stack)
      // and return it; mirrors sandbox-create's reuse/create logic. The pin
      // routes sandbox-create / sandbox-run one-shot to the same template, so the
      // session is consistent however it was provisioned.
      if (!config.repoUrl) {
        const existing = SESSION_STORE.get(storeKey);
        if (existing) {
          if (!isSessionOwnedByContext(existing, storeKey, context)) {
            return unauthorizedSessionMessage(existing.id);
          }
          if (await probeSession(existing, storeKey)) {
            return JSON.stringify({ sessionId: existing.id, status: "ready", reused: true });
          }
          evictSession(existing, storeKey);
        }
        const noRepoDuration = (params["sessionDurationMs"] as number | undefined) ?? (config.sessionTimeoutMs || 60 * 60 * 1000);
        const client = makeClient(context.config, config.template);
        const session = await client.createSession({
          timeoutMs: noRepoDuration,
          idleTimeoutMs: idleTimeoutForSessionCreation(context, undefined, config.idleTimeoutMs || 60 * 60 * 1000),
          template: config.template,
        });
        rememberSession(storeKey, session, config.template, ownerFromContext(context));
        await reportExperimentSandboxCreated(context, session, config.template);
        return JSON.stringify({ sessionId: session.id, status: "ready", template: config.template, ports: config.ports || {} });
      }

      const branchName = params["branchName"] as string;
      const baseBranch = (params["baseBranch"] as string | undefined) ?? config.defaultBranch;
      const sessionDurationMs = (params["sessionDurationMs"] as number | undefined) ?? (config.sessionTimeoutMs || 60 * 60 * 1000);
      const auxBranches = (params["auxBranches"] as Record<string, string> | undefined) ?? {};

      // Pull the originating user's email/name from the run meta. routes/run.ts
      // populates these from the /run request body. configureGitIdentity below
      // will set git config + install the post-commit identity hook in every workdir.
      const userEmail = context.meta?.["userEmail"];
      const userName = context.meta?.["userName"];
      const allWorkDirs = [config.workDir, ...(config.auxRepos?.map((r) => r.workDir) ?? [])];

      const log: string[] = [];

      // Fetch + checkout each auxiliary repo onto the requested branch
      // (or its default). Idempotent: if the branch is already current,
      // git fetch + checkout -B is a no-op on the worktree. Failures are
      // logged but don't abort setup — the image's baked default branch
      // is still usable.
      const checkoutAuxBranches = async (session: Session) => {
        if (!config.auxRepos?.length) return;
        for (const aux of config.auxRepos) {
          const branch = auxBranches[aux.name] ?? aux.defaultBranch;
          try {
            log.push(`Aux ${aux.name}: fetching ${branch}...`);
            const jobId = await session.commands.runDetached(
              `cd ${aux.workDir} && git fetch origin ${branch} && git checkout -B ${branch} FETCH_HEAD`,
            );
            const deadline = Date.now() + 60_000;
            let done = false;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 2_000));
              const status = await session.commands.pollJob(jobId);
              if (status.done) {
                done = true;
                if (status.exitCode !== null && status.exitCode !== 0) {
                  log.push(`Aux ${aux.name}: WARN ${branch} checkout failed (exit ${status.exitCode}); leaving on baked default.`);
                } else {
                  log.push(`Aux ${aux.name}: on ${branch}`);
                }
                break;
              }
            }
            if (!done) log.push(`Aux ${aux.name}: checkout still running after 60s; continuing.`);
          } catch (err) {
            log.push(`Aux ${aux.name}: WARN error — ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
          }
        }
      };

      const cached = SESSION_STORE.get(storeKey);
      if (cached) {
        if (!isSessionOwnedByContext(cached, storeKey, context)) {
          log.push(`Cached session ${cached.id} is not authorized for this user/conversation — ignoring.`);
        } else {
          // Only reuse sessions that were created with THIS config's
          // template. Two reasons to skip reuse:
          //   1. Different template — e.g. session was a hyperswitch one
          //      but this call is for xyne-spaces. The repo layout and
          //      services are wrong; evict + create fresh.
          //   2. Bare-warmpool VM (template-less sandbox-create session)
          //      — no git creds, no Nix services, no prebaked node_modules.
          // SESSION_TEMPLATE is populated by sandbox-repo-setup at
          // rememberSession time. If absent (legacy session created
          // before this tracking landed), fall back to the old fragile
          // substring check.
          const cachedTemplate =
            SESSION_TEMPLATE.get(storeKey) ?? SESSION_TEMPLATE.get(cached.id);
          // isSameTemplateFamily (not ===): a live session may have been
          // created on a ROTATED variant of config.template (e.g.
          // `agent-workspace-gvisor-template-c`), and a plain equality check
          // would treat it as the "wrong template" and needlessly recreate.
          const isRepoTemplate = cachedTemplate
            ? isSameTemplateFamily(cachedTemplate, config.template)
            : cached.id.includes("agent-workspace") || cached.id.includes("docker-dev");
          if (isRepoTemplate && await probeSession(cached, storeKey)) {
            log.push(`Reusing existing sandbox session ${cached.id}`);
            if (config.runtimeCredentialBinding) {
              await cleanupSdlcGitCredentialMaterial(cached).catch(() => undefined);
              const credentialMode = await installSdlcGitCredentialBootstrap(
                cached,
                config.runtimeCredentialBinding,
              );
              log.push(
                credentialMode === "credential"
                  ? "SDLC bootstrap refreshed: PAT helper and PAT-account commit identity installed."
                  : "SDLC bootstrap refreshed: anonymous read-only Git access selected.",
              );
            }
            try {
              // The pod prebakes a shallow clone of the default branch.
              // branchName might be:
              //   (a) an existing branch on origin (resume work on it), or
              //   (b) a brand-new branch to cut from baseBranch.
              // Try (a) first: `git fetch origin <branchName>` succeeds iff
              // the branch exists on remote -> checkout from FETCH_HEAD.
              // Fall back to (b): fetch baseBranch + cut new branch from
              // its tip. `checkout -B` is idempotent on re-runs.
              const checkoutJob = await cached.commands.runDetached(
                `cd ${config.workDir} && ` +
                `(if git fetch origin ${branchName} 2>/dev/null; then ` +
                `git checkout -B ${branchName} FETCH_HEAD; else ` +
                `git fetch origin ${baseBranch} && git checkout -B ${baseBranch} FETCH_HEAD && git checkout -B ${branchName}; fi)`,
              );
              const deadline = Date.now() + 30_000;
              while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 1_000));
                const status = await cached.commands.pollJob(checkoutJob);
                if (status.done) break;
              }
              log.push(`Checked out ${branchName} on existing session.`);
            } catch (err) {
              log.push(`Branch checkout failed: ${redactSecrets(err instanceof Error ? err.message : String(err))} (continuing anyway)`);
            }
            // Re-run aux branch checkouts even on reuse: caller may have
            // passed a different auxBranches map this turn. Idempotent if
            // already on the requested branches.
            await checkoutAuxBranches(cached);
            // Refresh git identity on reuse too — the userEmail/userName in
            // meta come from the caller's /run payload, so if a different
            // user picks up the conversation we want their identity now.
            if (config.runtimeCredentialBinding) {
              log.push("SDLC Git access binding refreshed for this run.");
            } else {
              await configureGitIdentity(cached, allWorkDirs, userEmail, userName, log);
            }
            return JSON.stringify({
              sessionId: cached.id,
              branch: branchName,
              reused: true,
              ports: config.ports || {},
              log: log.map(redactSecrets),
            });
          }
          if (!isRepoTemplate) {
            log.push(`Cached session ${cached.id} is on the wrong template — discarding and creating a fresh repo-template VM.`);
          } else {
            log.push(`Cached session ${cached.id} is dead — recreating.`);
          }
          evictSession(cached, storeKey);
        }
      }

      log.push("Creating sandbox session...");
      // Round-robin across the golden's N snapshot-backed template variants so
      // concurrent claims/warm-pool refills spread over N GCP snapshots instead
      // of hammering one past its per-source op-rate limit. Non-rotated
      // templates pass through unchanged. Remember the ACTUAL variant so reuse
      // (isSameTemplateFamily) and resume find the same pod.
      const claimTemplate = rotateTemplate(config.template);
      const client = makeClient(context.config, claimTemplate);
      const session = await client.createSession({
        timeoutMs: sessionDurationMs,
        idleTimeoutMs: idleTimeoutForSessionCreation(context, undefined, config.idleTimeoutMs || 60 * 60 * 1000),
        template: claimTemplate,
        readyTimeoutMs: config.readyTimeoutMs || 10 * 60 * 1000,
      });
      rememberSession(storeKey, session, claimTemplate, ownerFromContext(context));
      await reportExperimentSandboxCreated(context, session, claimTemplate);
      log.push(`Session created: ${session.id}`);
      if (config.runtimeCredentialBinding) {
        try {
          const credentialMode = await installSdlcGitCredentialBootstrap(
            session,
            config.runtimeCredentialBinding,
          );
          log.push(
            credentialMode === "credential"
              ? "SDLC bootstrap completed: PAT helper and PAT-account commit identity installed."
              : "SDLC bootstrap completed: anonymous read-only Git access selected.",
          );
        } catch (error) {
          await session.destroy().catch(() => undefined);
          evictSession(session, storeKey);
          throw error;
        }
      }

      const pollUntilDone = async (jobId: string, label: string, timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5_000));
          const status = await session.commands.pollJob(jobId);
          if (status.done) {
            if (status.exitCode !== null && status.exitCode !== 0) {
              throw new Error(`${label} failed (exit ${status.exitCode}): ${redactSecrets(status.stderr ?? "")}`);
            }
            log.push(`${label} done.`);
            return status;
          }
          log.push(`${label} still running...`);
        }
        throw new Error(`${label} timed out after ${timeoutMs / 1000}s`);
      };

      // Probe for a baked clone in the workspace image.
      //
      // Two flavors of "baked":
      //   1. Legacy agent-workspace image — clone is in the docker
      //      image at build time, so /workspace/<repo>/.git is present
      //      from second 0 of pod life. Probe succeeds immediately.
      //   2. Golden image + per-template prebake ConfigMap (hyperswitch
      //      and any future template) — repos are cloned at BOOT by
      //      prebake.sh. The :8888 workspace server opens before the
      //      prebake's clone finishes, so the probe could race and see
      //      "missing", which would fall through to the manual-clone
      //      else-branch below and skip the prebake-done wait entirely.
      //
      // To handle both, poll for the clone for up to 10 min. Legacy
      // templates hit it on the first probe; golden+prebake templates
      // hit it once the prebake's clone step lands (typically <60s).
      // If it really never appears (network failure on git clone), we
      // fall through to the manual-clone safety net as before.
      log.push(config.skipBakedCloneWait ? "Generic repository; cloning immediately..." : "Waiting for baked clone to appear...");
      const cloneWaitDeadline = config.skipBakedCloneWait ? Date.now() : Date.now() + 10 * 60_000;
      let bakedCloneFound = false;
      while (Date.now() < cloneWaitDeadline) {
        try {
          const probe = await session.commands.run(
            `test -d ${config.workDir}/.git && echo present || echo missing`,
            5_000,
          );
          if ((probe.stdout ?? "").trim() === "present") {
            bakedCloneFound = true;
            break;
          }
        } catch {
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      if (bakedCloneFound) {
        log.push("Baked clone present.");
      } else {
        log.push("Baked clone not found after 10 min — falling back to manual clone.");
      }

      if (bakedCloneFound) {
        // The prebake clones the default branch shallowly. branchName
        // might be (a) an existing remote branch (resume work) or (b)
        // a new branch to cut from baseBranch. Try (a); fall back to
        // (b). `checkout -B` is idempotent across re-runs.
        log.push(`Baked clone detected at ${config.workDir} — checking out ${branchName} (resume if exists, else cut from ${baseBranch}).`);
        // Discard any tree modifications left by the image build or the
        // in-flight boot-time prebake. The prebake runs `npm ci × 3` and
        // `nix build` in the background, and those can race ahead of this
        // checkout — `npm ci` regenerates package-lock.json on minor engine
        // drift, nix-build can stage shadow files inside the worktree, etc.
        // Without this reset, `git checkout -B` would refuse with
        // "Your local changes to the following files would be overwritten by
        // checkout" (observed on the doctor-agent daily-sync cron — the cron
        // always lands here because its scheduler uses a unique
        // conversationId per firing, so it never hits the reuse path).
        // Safe here because this fresh-VM branch only ever runs against a
        // brand-new sandbox whose tree mutations all come from automated
        // boot scripts — never user work. Interactive re-calls hit the
        // reuse path (above) which leaves the tree alone.
        // ALWAYS FETCH — never skip freshness. But only do the DESTRUCTIVE part
        // (reset --hard + checkout) when it would actually change something.
        //
        // Why: after a PVC clone from a snapshot, git sees stat-dirty index
        // entries, so `git reset --hard` rewrites the worktree and every file
        // gets a new mtime — even when content is byte-identical. Build systems
        // key on mtime, so that silently destroys the golden's most expensive
        // artifact. Measured 2026-08-29 on hyperswitch: 2113 .rs files restamped
        // at claim time, the prebuilt 4.85GB `router` (built 20:10) ended up
        // OLDER than its sources (20:52), and the prebake began a ~24-min
        // rebuild for a checkout that was literally `main -> main`.
        //
        // The trade this AVOIDS: skipping the fetch would keep the cache but
        // silently pin the agent to whatever commit the golden baked, so a stale
        // golden would serve stale code under the right branch name. Fetching
        // first keeps that honest — when the branch really has moved we take the
        // reset+checkout and the rebuild is legitimate work, not waste.
        const fetchState = await session.commands.run(
          `cd ${config.workDir} && ` +
          `git fetch origin ${branchName} 2>/dev/null && ` +
          `test "$(git rev-parse HEAD 2>/dev/null)" = "$(git rev-parse FETCH_HEAD 2>/dev/null)" && ` +
          `test -z "$(git status --porcelain 2>/dev/null)" && echo current || echo stale`,
          60_000,
        ).catch(() => ({ stdout: "stale" }) as { stdout: string });
        if ((fetchState.stdout ?? "").trim() === "current") {
          log.push(
            `${branchName} already at origin tip with a clean tree — skipping reset/checkout ` +
            `(a reset here restamps every file and forces a full rebuild).`,
          );
        } else {
          const branchJobId = await session.commands.runDetached(
            `cd ${config.workDir} && ` +
            `git reset --hard HEAD 2>/dev/null; git clean -fd 2>/dev/null; ` +
            `(if git fetch origin ${branchName} 2>/dev/null; then ` +
            `git checkout -B ${branchName} FETCH_HEAD; else ` +
            `git fetch origin ${baseBranch} && git checkout -B ${baseBranch} FETCH_HEAD && git checkout -B ${branchName}; fi)`,
          );
          await pollUntilDone(branchJobId, `git fetch+checkout ${branchName}`, 60_000);
        }

        // Prebake (entrypoint runs npm ci × 3 + nix build .#xyne-space-services
        // in the background) drops /tmp/prebake-done when it finishes. Wait
        // for that marker before starting services / dev servers — otherwise
        // a claim that lands mid-prebake can hit half-installed node_modules
        // and `npm run dev` fails with random missing-module errors.
        //
        // CRITICAL: poll with SHORT commands. The workspace server uses
        // execSync (agent-workspace/src/main.ts:117), which blocks the
        // Node.js event loop for the duration of the shell call. A single
        // 10-min `commands.run` would freeze ALL other HTTP requests on
        // 8888 → sandbox-router returns "internal error" / "Could not
        // connect to backend sandbox" → claw's STALE_PATTERNS fire →
        // claim eviction storm. Instead: 2-sec probes in a JS loop, with
        // sleep on the claw side, so the event loop stays unblocked.
        log.push("Waiting for prebake-done marker...");
        // 45-min budget covers the worst-case template cold-start
        // (hyperswitch's prebake gates prebake-done on services-up,
        // migrations-up, ucs-up, router-up — cargo cold build is
        // 25-35 min). xyne-spaces hits this marker within minutes;
        // the long ceiling only matters for slow templates.
        const prebakeDeadline = Date.now() + 45 * 60_000;
        let prebakeDone = false;
        let backendCrash = "";
        // How long we tolerate the backend NOT binding :3001 before treating it
        // as a hard crash (vs a slow-but-progressing build). Slow templates
        // (hyperswitch cabal/cargo) legitimately take many minutes, so only trip
        // this once services-up is present AND the backend dev log shows a fatal
        // startup error — a crash, not slow progress.
        const CRASH_GRACE_MS = 8 * 60_000;
        // DETERMINISTIC failures get a much shorter grace. A config-schema
        // rejection can never resolve by waiting — the backend re-reads the
        // same .env.local and fails identically every time — so holding the
        // agent for the full CRASH_GRACE_MS buys nothing. Measured 2026-08-29:
        // a claim whose mounted Secret still carried
        //     LIVEKIT_API_KEY=devkey
        // ("must not be the published development key") burned ~12 min before
        // reporting anything, 8 of which was this grace, and then handed the
        // agent a sandbox with no backend/dashboard. Slow-but-progressing
        // templates (hyperswitch cargo cold build, 25-35 min) never emit these
        // patterns, so they keep the long grace below.
        const FATAL_GRACE_MS = 90_000;
        const FATAL_PATTERNS = "Config validation error|must not be the published|is required";
        const startedWaitAt = Date.now();
        while (Date.now() < prebakeDeadline) {
          try {
            const probe = await session.commands.run(
              `test -f /tmp/prebake-done && echo done || echo pending`,
              5_000,
            );
            if ((probe.stdout ?? "").trim() === "done") {
              prebakeDone = true;
              break;
            }
            // Deterministic config rejections: check from ~90s. These cannot
            // clear by waiting, so there is nothing to be gained by the long
            // grace — and the agent gets an actionable message instead of a
            // silent "Executing tools…".
            const waited = Date.now() - startedWaitAt;
            if (waited > FATAL_GRACE_MS && waited <= CRASH_GRACE_MS) {
              const fatal = await session.commands.run(
                `grep -iE "${FATAL_PATTERNS}" /tmp/prebake-backend-dev.log 2>/dev/null | tail -4`,
                8_000,
              ).catch(() => ({ stdout: "" }) as { stdout: string });
              const f = (fatal.stdout ?? "").trim();
              if (f) { backendCrash = f; break; }
            }
            // Fast-fail on a DEFINITIVE backend crash so a bad golden bake (e.g.
            // env-schema drift: "DATABASE_URL is required") surfaces in ~8 min,
            // not after the full 45-min budget as a silent "Executing tools…".
            if (Date.now() - startedWaitAt > CRASH_GRACE_MS) {
              const diag = await session.commands.run(
                `nc -z 127.0.0.1 3001 && echo up || (echo down; ` +
                `grep -iE "Config validation error|is required|Error:|Cannot find|is not a function|EADDRINUSE" ` +
                `/tmp/prebake-backend-dev.log 2>/dev/null | tail -6)`,
                8_000,
              ).catch(() => ({ stdout: "" }) as { stdout: string });
              const out = (diag.stdout ?? "").trim();
              if (out.startsWith("down") && out.length > "down".length) {
                backendCrash = out.replace(/^down\s*/, "");
                break;
              }
            }
          } catch (err) {
            log.push(`prebake probe transient error (continuing): ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
          }
          await new Promise((r) => setTimeout(r, 5_000));
        }
        if (prebakeDone) {
          log.push("Prebake finished; proceeding to services + dev servers.");
        } else if (backendCrash) {
          // Loud, actionable failure instead of a silent timeout. Surface the
          // backend crash tail so the agent (and humans) see the real cause.
          log.push(
            `Backend failed to start in this sandbox — the baked backend is crashing on boot ` +
            `(likely a stale golden vs repo drift). Prebake never completed, so this dev sandbox ` +
            `is not fully usable. Backend error tail:\n${redactSecrets(backendCrash)}`,
          );
        } else {
          log.push("Warning: prebake didn't finish in 45min — proceeding anyway, expect possible npm errors.");
        }
      } else {
        // Should never happen with the agent-workspace image (entrypoint
        // prebakes the clone), but kept as a safety net for older / bare
        // sandbox templates that haven't been migrated.
        const cloneCmd = buildRepoCloneCommand(config, baseBranch);
        log.push(`No baked clone — cloning ${config.repoUrl} (${baseBranch})...`);
        const cloneJobId = await session.commands.runDetached(cloneCmd);
        await pollUntilDone(cloneJobId, "git clone", config.cloneTimeoutMs ?? 5 * 60_000);
        log.push("Cutting branch: " + branchName);
        const branchJobId = await session.commands.runDetached(
          `cd ${config.workDir} && (git checkout ${branchName} 2>/dev/null || git checkout -b ${branchName})`,
        );
        await pollUntilDone(branchJobId, "git checkout", 30_000);
      }

      // Auxiliary repos: fetch + checkout user-overridable branches. The
      // prebake clones these alongside the primary; here we just refresh
      // them to the agent's requested branch. No-op when config has no
      // auxRepos (xyne-spaces and any other single-repo template).
      await checkoutAuxBranches(session);

      // Author every commit as the human who triggered this run, with
      // Xyne Spaces as committer. Runs across primary + aux workdirs.
      if (config.runtimeCredentialBinding) {
        log.push("SDLC Git access binding configured for this run.");
      } else {
        await configureGitIdentity(session, allWorkDirs, userEmail, userName, log);
      }

      const jobIds: Record<string, string> = {};

      for (const step of config.steps) {
        switch (step.type) {
          case "install": {
            // With baked node_modules in the kata-workspace image, npm ci is
            // mostly a verify+sync. --prefer-offline hits the local cache first,
            // --no-audit/--no-fund skip two network round-trips. Falls back to
            // verdaccio (in-cluster) when needed.
            for (const pkg of step.packages) {
              log.push(`npm install: ${pkg}...`);
              const cmd = step.cmd || `cd ${config.workDir}/${pkg} && npm ci --prefer-offline --no-audit --no-fund --no-progress --loglevel=error`;
              const jobId = await session.commands.runDetached(cmd);
              await pollUntilDone(jobId, `npm ci ${pkg}`, 10 * 60_000);
            }
            break;
          }

          case "services": {
            // Skip the launch if the prebake already started services
            // (entrypoint.sh drops `step.markerPath` when ports are up).
            // Trying to launch twice would fail with "address already
            // in use" on postgres/redis/etc.
            let alreadyRunning = false;
            if (step.markerPath) {
              try {
                const probe = await session.commands.run(
                  `test -f ${step.markerPath} && echo present || echo missing`,
                  5_000,
                );
                alreadyRunning = (probe.stdout ?? "").trim() === "present";
              } catch { alreadyRunning = false; }
            }
            if (alreadyRunning) {
              log.push("Services already running (prebake) — skipping launch.");
            } else {
              log.push("Starting services...");
              const jobId = await session.commands.runDetached(step.cmd);
              jobIds.services = jobId;
            }
            
            if (step.healthCheck) {
              const deadline = Date.now() + step.healthCheck.timeoutMs;
              let servicesReady = false;
              
              while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, step.healthCheck!.intervalMs));
                const healthResult = await session.commands.run(step.healthCheck.cmd, 15_000);
                
                if (step.healthCheck.successCondition === "all-healthy") {
                  const lines = healthResult.stdout.trim().split("\n").filter(Boolean);
                  if (lines.length > 0 && lines.every((l) => l.startsWith("Up") || l.includes("healthy"))) {
                    servicesReady = true;
                    log.push(`All ${lines.length} service(s) healthy.`);
                    break;
                  }
                  log.push(`Waiting for services... (${lines.length} containers seen)`);
                } else if (step.healthCheck.successCondition === "all-up") {
                  // Probe-script reports `all-up` on stdout when every
                  // expected port is bound (Nix process-compose path; no
                  // docker). Anything else means we're still waiting —
                  // log MISSING:<port> lines if the probe printed any.
                  const out = healthResult.stdout.trim();
                  if (out === "all-up") {
                    servicesReady = true;
                    log.push("All services listening.");
                    break;
                  }
                  const missing = out.split("\n").filter((l) => l.startsWith("MISSING:"));
                  log.push(`Waiting for services... ${missing.length ? missing.join(" ") : "(no ports bound yet)"}`);
                }
              }
              
              if (!servicesReady) {
                log.push("Warning: services may not be fully ready yet, proceeding anyway.");
              }
            }
            break;
          }

          case "devserver": {
            // Same skip-if-marker-present logic as the services step.
            // Prebake's npm-run-dev would still hold port 3001/5173, so a
            // second `npm run dev` would EADDRINUSE.
            let alreadyRunning = false;
            if (step.markerPath) {
              try {
                const probe = await session.commands.run(
                  `test -f ${step.markerPath} && echo present || echo missing`,
                  5_000,
                );
                alreadyRunning = (probe.stdout ?? "").trim() === "present";
              } catch { alreadyRunning = false; }
            }
            if (alreadyRunning) {
              log.push(`${step.name} already running (prebake) — skipping launch.`);
            } else {
              log.push(`Starting ${step.name}...`);
              const jobId = await session.commands.runDetached(`cd ${step.cwd} && ${step.cmd}`);
              jobIds[step.name] = jobId;
            }
            break;
          }

          case "run": {
            log.push(`Running: ${step.label}...`);
            const cwd = step.cwd || config.workDir;
            const jobId = await session.commands.runDetached(`cd ${cwd} && ${step.cmd}`);
            await pollUntilDone(jobId, step.label, step.timeoutMs || 5 * 60_000);
            break;
          }
        }
      }

      log.push("Setup complete.");

      return JSON.stringify({
        sessionId: session.id,
        branch: branchName,
        ...jobIds,
        ports: config.ports || {},
        log: log.map(redactSecrets),
      });
    },
  };
  return withRepoSetupSingleFlight(tool);
}

// Read-only git for the shared sbx-git sandbox: read ANY branch by ref without
// a checkout (so concurrent runs can read different branches safely). Allowed
// subcommands never mutate the working tree, local branches, or the remote.
// `fetch` is permitted because it only appends objects + remote-tracking refs.
const GIT_READ_SUBCMDS = new Set([
  "fetch", "show", "grep", "diff", "log", "ls-tree", "ls-files",
  "blame", "branch", "rev-parse", "cat-file", "shortlog", "describe", "tag",
]);
// Flags that could mutate state even under an allowed subcommand (e.g. `branch -D`).
const GIT_READ_DENY_FLAGS = new Set([
  "-d", "-D", "--delete", "-m", "-M", "--move", "-f", "--force",
  "--set-upstream", "--set-upstream-to", "-u", "--track",
]);
// Block shell chaining / injection — args are passed through a shell string.
const GIT_READ_SHELL_META = /[;&|`$(){}<>\n\r\\]/;

/**
 * git-read — read-only git in the shared sbx-git sandbox. Lets an agent read a
 * specific branch by REF (never `git checkout`, which would corrupt the shared
 * working tree for other runs). Typical flow:
 *   git-read repo=xyne-spaces args=["fetch","--depth","1","origin","<branch>"]
 *   git-read repo=xyne-spaces args=["grep","origin/<branch>","<pattern>"]
 *   git-read repo=xyne-spaces args=["show","origin/<branch>:path/to/file"]
 */
export const gitRead: ToolDefinition = {
  slug: "git-read",
  name: "Git Read (read-only)",
  description:
    "Read-only git in the shared read-only sandbox. Read ANY branch by ref WITHOUT checkout. " +
    "Allowed: fetch, show, grep, diff, log, ls-tree, ls-files, blame, branch, rev-parse, cat-file, shortlog, describe, tag. " +
    "To read a branch: args=['fetch','--depth','1','origin','<branch>'] then args=['grep','origin/<branch>','<pattern>'] or args=['show','origin/<branch>:<path>']. " +
    "Never checks out, writes, commits, or pushes.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repo dir under /workspace (e.g. 'xyne-spaces')." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Git args. First element must be a read-only subcommand (e.g. ['grep','origin/main','pattern']).",
      },
      sessionId: { type: "string", description: "Optional; defaults to the shared sbx-git session for this conversation." },
      timeoutMs: { type: "number", description: "Command timeout ms (default 60000)." },
    },
    required: ["repo", "args"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const repo = ((params["repo"] as string) || "").trim();
    const args = (params["args"] as string[]) || [];
    const timeoutMs = (params["timeoutMs"] as number | undefined) ?? 60_000;
    if (!repo || !/^[\w.-]+$/.test(repo)) return "Error: invalid repo name.";
    if (!Array.isArray(args) || args.length === 0) return "Error: args required.";
    const sub = String(args[0]);
    if (!GIT_READ_SUBCMDS.has(sub)) {
      return `Error: '${sub}' is not a read-only git subcommand. Allowed: ${[...GIT_READ_SUBCMDS].join(", ")}.`;
    }
    for (const a of args) {
      if (typeof a !== "string") return "Error: all args must be strings.";
      if (GIT_READ_SHELL_META.test(a)) return "Error: shell metacharacters are not allowed in args.";
      if (GIT_READ_DENY_FLAGS.has(a)) return `Error: flag '${a}' can mutate state and is not allowed in git-read.`;
    }
    const { SBX_GIT } = await import("./repo-configs.js");
    const repoPath = SBX_GIT.repoPaths[repo] ?? `/workspace/${repo}`;
    const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const cmd = `git -C '${repoPath}' ${quoted}`;

    const explicit = params["sessionId"] as string | undefined;
    const storeKey = storeKeyFromContext(context);
    const session =
      (explicit ? SESSION_STORE.get(explicit) : undefined) ??
      (storeKey ? SESSION_STORE.get(storeKey) : undefined);
    if (!session) return "Error: no sandbox session — call sandbox-repo-setup first.";
    if (!isSessionOwnedByContext(session, explicit ?? storeKey, context)) {
      return unauthorizedSessionMessage(session.id);
    }
    try {
      const result = await session.commands.run(cmd, timeoutMs);
      return redactAndStringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
    } catch (err) {
      if (isStaleSessionError(err)) {
        evictSession(session, storeKey);
        return "Error: sandbox session died (pod replaced). Call sandbox-repo-setup to re-provision.";
      }
      return sandboxErr(err);
    }
  },
};

const WIKI_GIT_SHA = /^[0-9a-f]{40}$/i;
const WIKI_GIT_REF = /^[0-9a-f]{9,40}$/i;
const WIKI_GIT_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0\r\n]+$/;
const WIKI_GIT_CUMULATIVE_OUTPUT_LIMIT = 5_000_000;
export const WIKI_GIT_COMMAND_TIMEOUT_MS = 120_000;
export const WIKI_GIT_METADATA_TIMEOUT_MS = 30_000;
const WIKI_GIT_OUTPUT_BYTES = new Map<string, number>();

class WikiGitCommandTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Wiki Git sandbox command exceeded the ${timeoutMs}ms wall-clock deadline`);
    this.name = "WikiGitCommandTimeoutError";
  }
}

/**
 * The sandbox SDK receives its own timeout, but a disconnected command stream
 * can fail to settle that promise. Keep the agent run bounded independently.
 */
export async function withWikiGitWallClockTimeout<T>(
  startOperation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new WikiGitCommandTimeoutError(timeoutMs)), timeoutMs);
      timer.unref?.();
    });
    // Defer the SDK invocation by one microtask so the deadline is armed even
    // when the SDK does synchronous work before returning its command promise.
    const operation = Promise.resolve().then(startOperation);
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function runWikiGitCommand(session: Session, command: string, timeoutMs: number) {
  return withWikiGitWallClockTimeout(() => session.commands.run(command, timeoutMs), timeoutMs);
}

function wikiGitSandboxFailure(
  error: unknown,
  session: Session,
  storeKey: string,
): string | null {
  if (error instanceof WikiGitCommandTimeoutError) {
    evictSession(session, storeKey);
    void session.destroy().catch(() => undefined);
    return "Error: sandbox command timed out; sandbox was evicted — call sandbox-repo-setup to recreate it.";
  }
  if (isStaleSessionError(error)) {
    evictSession(session, storeKey);
    return "Error: sandbox session died; call sandbox-repo-setup to recreate it.";
  }
  return null;
}

export function wikiGitOutputBudgetKey(
  context: ToolExecutionContext,
  sandboxStoreKey: string,
): string {
  const agentSessionId = context.meta?.["sdlcSessionId"]?.trim();
  return agentSessionId ? `${sandboxStoreKey}:${agentSessionId}` : sandboxStoreKey;
}

function recordWikiGitOutput(key: string, bytes: number): void {
  if (!WIKI_GIT_OUTPUT_BYTES.has(key) && WIKI_GIT_OUTPUT_BYTES.size >= 1_000) {
    const oldest = WIKI_GIT_OUTPUT_BYTES.keys().next().value;
    if (typeof oldest === "string") WIKI_GIT_OUTPUT_BYTES.delete(oldest);
  }
  WIKI_GIT_OUTPUT_BYTES.set(key, bytes);
}

export function truncateWikiGitOutput(value: string, maxBytes: number): {
  value: string;
  totalBytes: number;
  truncated: boolean;
} {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return { value, totalBytes: buffer.length, truncated: false };
  return {
    value: buffer.subarray(0, maxBytes).toString("utf8"),
    totalBytes: buffer.length,
    truncated: true,
  };
}

function wikiGitArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function wikiAllowedRefs(context: ToolExecutionContext): Set<string> {
  const refs = new Set<string>();
  const raw = context.meta?.["sdlcWikiAssignedCommitShas"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) if (typeof value === "string" && WIKI_GIT_SHA.test(value)) refs.add(value);
      }
    } catch { /* invalid trusted context is rejected by the empty set */ }
  }
  for (const key of ["sdlcWikiBootstrapRef", "sdlcWikiTargetHeadSha"]) {
    const value = context.meta?.[key];
    if (value && WIKI_GIT_SHA.test(value)) refs.add(value);
  }
  return refs;
}

export function resolveWikiGitCommitRef(
  requestedRef: string,
  allowedRefs: ReadonlySet<string>,
): string | null {
  const requested = requestedRef.trim().toLowerCase();
  if (!WIKI_GIT_REF.test(requested)) return null;
  const matches = [...allowedRefs]
    .map((ref) => ref.toLowerCase())
    .filter((ref) => ref.startsWith(requested));
  return matches.length === 1 ? matches[0]! : null;
}

function wikiGitDisplayRef(ref: string, allowedRefs: ReadonlySet<string>): string {
  for (let length = 9; length < ref.length; length += 1) {
    const prefix = ref.slice(0, length);
    if ([...allowedRefs].filter((candidate) => candidate.startsWith(prefix)).length === 1) {
      return prefix;
    }
  }
  return ref;
}

export function sanitizeWikiGitCommitOutput(
  value: string,
  canonicalRef: string,
  displayRef: string,
): string {
  return value.replaceAll(canonicalRef, displayRef);
}

/** Historical Git reader dedicated to backend-supervised SDLC Wiki runs. */
export const sdlcGitContext: ToolDefinition = {
  slug: SDLC_TOOL_NAMES.gitContext,
  name: "SDLC Git Context",
  description:
    "Read bounded historical code for the trusted SDLC run. " +
    "No checkout, branch, commit, push, reset, clean, interpreter, or arbitrary shell input.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["commit_context", "range_context", "read_patch", "read_file", "list_tree", "search", "path_history"],
      },
      commitSha: { type: "string", pattern: "^[0-9a-fA-F]{9,40}$" },
      beforeSha: { type: "string", pattern: "^(?:[0-9a-fA-F]{9,40}|ROOT_BOOTSTRAP)$", description: "Trusted history-window boundary ref." },
      afterSha: { type: "string", pattern: "^[0-9a-fA-F]{9,40}$", description: "Trusted history-window endpoint ref." },
      path: { type: "string", minLength: 1, maxLength: 1024, pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*//)[^\\0\\r\\n]+$" },
      pattern: { type: "string", minLength: 1, maxLength: 500, pattern: "^[^\\0\\r\\n]+$" },
      maxBytes: { type: "integer", minimum: 1_000, maximum: 500_000, description: "Maximum returned bytes; capped at 500000." },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Byte offset for read_patch continuation; defaults to 0.",
      },
    },
    required: ["operation"],
    oneOf: [
      { properties: { operation: { const: "commit_context" } }, required: ["operation", "commitSha"] },
      { properties: { operation: { const: "range_context" } }, required: ["operation", "beforeSha", "afterSha"] },
      {
        properties: { operation: { const: "read_patch" } },
        required: ["operation"],
        oneOf: [
          { required: ["commitSha"] },
          { required: ["beforeSha", "afterSha"] },
        ],
      },
      { properties: { operation: { const: "read_file" } }, required: ["operation", "commitSha", "path"] },
      { properties: { operation: { const: "list_tree" } }, required: ["operation", "commitSha"] },
      { properties: { operation: { const: "search" } }, required: ["operation", "commitSha", "pattern"] },
      { properties: { operation: { const: "path_history" } }, required: ["operation", "commitSha", "path"] },
    ],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    if (context.meta?.["sdlcWikiRun"] !== "true") return "Error: tool is restricted to SDLC Wiki runs.";
    const operation = String(params["operation"] ?? "");
    const requestedCommitRef =
      typeof params["commitSha"] === "string" ? params["commitSha"].trim() : "";
    const requestedPath = typeof params["path"] === "string" ? params["path"].trim() : "";
    const requestedBeforeRef = typeof params["beforeSha"] === "string" ? params["beforeSha"].trim() : "";
    const requestedAfterRef = typeof params["afterSha"] === "string" ? params["afterSha"].trim() : "";
    const pattern = typeof params["pattern"] === "string" ? params["pattern"] : "";
    const maximumBytes = 500_000;
    const requestedMax = Number(params["maxBytes"] ?? maximumBytes);
    const requestedOffset = Number(params["offset"] ?? 0);
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : -1;
    const maxBytes = Number.isSafeInteger(requestedMax) && requestedMax >= 1_000 && requestedMax <= maximumBytes
      ? requestedMax
      : -1;

    const allowedRefs = wikiAllowedRefs(context);
    const isRangeRequest =
      operation === "range_context" ||
      (operation === "read_patch" && Boolean(requestedBeforeRef || requestedAfterRef));
    const rangeBeforeIsRoot =
      isRangeRequest &&
      requestedBeforeRef === "ROOT_BOOTSTRAP" &&
      context.meta?.["sdlcWikiBootstrapRef"] === "ROOT_BOOTSTRAP";
    const rangeBeforeSha = rangeBeforeIsRoot
      ? null
      : resolveWikiGitCommitRef(requestedBeforeRef, allowedRefs);
    const rangeAfterSha = resolveWikiGitCommitRef(requestedAfterRef, allowedRefs);
    if (isRangeRequest && ((!rangeBeforeIsRoot && !rangeBeforeSha) || !rangeAfterSha)) {
      return "Error: range boundary is not assigned to this Wiki run.";
    }
    const commitSha =
      isRangeRequest ? rangeAfterSha! : resolveWikiGitCommitRef(requestedCommitRef, allowedRefs);
    if (!commitSha) {
      return "Error: commit is not assigned to this Wiki run.";
    }
    const displayCommitRef = wikiGitDisplayRef(commitSha, allowedRefs);
    if (
      requestedPath &&
      (requestedPath.length > 1024 || requestedPath.includes("//") || !WIKI_GIT_PATH.test(requestedPath))
    ) return "Error: invalid repository-relative path.";
    if (pattern && (pattern.length > 500 || /[\0\r\n]/.test(pattern))) return "Error: invalid search pattern.";
    if (operation === "read_patch" && offset < 0) {
      return "Error: offset must be a non-negative integer.";
    }
    if (maxBytes < 0) {
      return "Error: maxBytes must be an integer between 1000 and 500000.";
    }

    const dynamicRepo = resolveDynamicSdlcRepositoryConfig(context);
    if (!dynamicRepo) return "Error: trusted SDLC repository context is required.";
    const storeKey = storeKeyFromContext(context);
    if (!storeKey) return "Error: trusted Wiki execution identity is required.";
    const session = SESSION_STORE.get(storeKey);
    if (!session) return "Error: no sandbox session — call sandbox-repo-setup first.";
    if (!isSessionOwnedByContext(session, storeKey, context)) return unauthorizedSessionMessage(session.id);
    const outputBudgetKey = wikiGitOutputBudgetKey(context, storeKey);
    const usedOutputBytes = WIKI_GIT_OUTPUT_BYTES.get(outputBudgetKey) ?? 0;
    const remainingOutputBytes = WIKI_GIT_CUMULATIVE_OUTPUT_LIMIT - usedOutputBytes;
    if (remainingOutputBytes <= 0) {
      return "Error: Wiki Git cumulative output limit reached for this run.";
    }
    const boundedMaxBytes = Math.min(maxBytes, remainingOutputBytes);
    const repoPath = dynamicRepo.config.workDir;
    const git = `git -C ${wikiGitArg(repoPath)}`;
    const patchPath =
      isRangeRequest
        ? `/tmp/sdlc-wiki-range-${(rangeBeforeSha ?? "root").slice(0, 12)}-${commitSha.slice(0, 12)}.patch`
        : `/tmp/sdlc-wiki-${commitSha.toLowerCase()}.patch`;
    if (operation === "commit_context" || operation === "range_context" || operation === "read_patch") {
      try {
        if (operation === "commit_context" || operation === "range_context") {
          const diffBase = rangeBeforeSha ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
          const writeCommand =
            operation === "range_context"
              ? `${git} diff --find-renames --stat --patch --binary ${wikiGitArg(diffBase)} ${wikiGitArg(commitSha)} > ${wikiGitArg(patchPath)}`
              : `${git} show --find-renames --format=fuller --stat --patch ${wikiGitArg(commitSha)} > ${wikiGitArg(patchPath)}`;
          const written = await runWikiGitCommand(session, writeCommand, WIKI_GIT_COMMAND_TIMEOUT_MS);
          if (written.exitCode !== 0) {
            return redactAndStringify({ operation, stderr: written.stderr.slice(0, 20_000), exitCode: written.exitCode });
          }
        }
        const readCommand = `dd if=${wikiGitArg(patchPath)} bs=1 skip=${offset} count=${boundedMaxBytes} 2>/dev/null`;
        const result = await runWikiGitCommand(session, readCommand, WIKI_GIT_COMMAND_TIMEOUT_MS);
        const sizeResult = await runWikiGitCommand(
          session,
          `wc -c < ${wikiGitArg(patchPath)}`,
          WIKI_GIT_METADATA_TIMEOUT_MS,
        );
        const totalBytes = Number.parseInt(sizeResult.stdout.trim(), 10);
        const returnedBytes = Buffer.byteLength(result.stdout, "utf8");
        const consumedBytes = Number.isFinite(totalBytes)
          ? Math.max(0, Math.min(boundedMaxBytes, totalBytes - offset))
          : returnedBytes;
        const nextOffset = offset + consumedBytes;
        recordWikiGitOutput(outputBudgetKey, usedOutputBytes + consumedBytes);
        let changedFiles;
        let relevance;
        let commits;
        if (operation === "commit_context" || operation === "range_context") {
          const diffBase = rangeBeforeSha ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
          const namesResult = await runWikiGitCommand(
            session,
            operation === "range_context"
              ? `${git} diff --name-status --find-renames ${wikiGitArg(diffBase)} ${wikiGitArg(commitSha)}`
              : `${git} show --first-parent --format= --name-status --find-renames ${wikiGitArg(commitSha)}`,
            WIKI_GIT_METADATA_TIMEOUT_MS,
          );
          if (namesResult.exitCode !== 0) {
            return redactAndStringify({
              operation,
              stderr: namesResult.stderr.slice(0, 20_000),
              exitCode: namesResult.exitCode,
            });
          }
          changedFiles = parseWikiNameStatus(namesResult.stdout);
          relevance = classifyWikiCommitRelevance(changedFiles);
          if (operation === "range_context") {
            const logRange = rangeBeforeSha ? `${rangeBeforeSha}..${commitSha}` : commitSha;
            const logResult = await runWikiGitCommand(
              session,
              `${git} log --first-parent --reverse --abbrev=9 --format=%h%x09%p%x09%aI%x09%s ${wikiGitArg(logRange)}`,
              WIKI_GIT_METADATA_TIMEOUT_MS,
            );
            if (logResult.exitCode !== 0) {
              return redactAndStringify({
                operation,
                stderr: logResult.stderr.slice(0, 20_000),
                exitCode: logResult.exitCode,
              });
            }
            commits = logResult.stdout
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                const [sha, parents, authoredAt, ...subject] = line.split("\t");
                return { sha, parents: parents?.split(" ").filter(Boolean) ?? [], authoredAt, subject: subject.join("\t") };
              });
          }
        }
        return redactAndStringify({
          operation,
          stdout: sanitizeWikiGitCommitOutput(result.stdout, commitSha, displayCommitRef),
          ...(operation === "commit_context" || operation === "range_context"
            ? {
                changedFiles,
                relevance,
                ...(commits ? { commits } : {}),
                ...(operation === "range_context"
                  ? {
                      beforeRef: rangeBeforeSha
                        ? wikiGitDisplayRef(rangeBeforeSha, allowedRefs)
                        : "ROOT_BOOTSTRAP",
                      afterRef: displayCommitRef,
                    }
                  : {}),
              }
            : {}),
          patchPath,
          offset,
          nextOffset,
          truncated: Number.isFinite(totalBytes) && nextOffset < totalBytes,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
          stderr: result.stderr.slice(0, 20_000),
          exitCode: result.exitCode,
        });
      } catch (error) {
        const failure = wikiGitSandboxFailure(error, session, storeKey);
        if (failure) return failure;
        return sandboxErr(error);
      }
    }
    let args: string[];
    switch (operation) {
      case "read_file":
        if (!requestedPath) return "Error: path is required.";
        args = ["show", `${commitSha}:${requestedPath}`];
        break;
      case "list_tree":
        args = ["ls-tree", "-r", "--name-only", commitSha, ...(requestedPath ? ["--", requestedPath] : [])];
        break;
      case "search":
        if (!pattern) return "Error: pattern is required.";
        args = ["grep", "-n", "-I", "-e", pattern, commitSha, ...(requestedPath ? ["--", requestedPath] : [])];
        break;
      case "path_history":
        if (!requestedPath) return "Error: path is required.";
        args = ["log", "--follow", "--abbrev=9", "--format=%h%x09%aI%x09%s", commitSha, "--", requestedPath];
        break;
      default:
        return "Error: unsupported Wiki Git operation.";
    }
    try {
      const command = `${git} ${args.map(wikiGitArg).join(" ")}`;
      const result = await runWikiGitCommand(session, command, WIKI_GIT_COMMAND_TIMEOUT_MS);
      const bounded = truncateWikiGitOutput(result.stdout, boundedMaxBytes);
      recordWikiGitOutput(
        outputBudgetKey,
        usedOutputBytes + Buffer.byteLength(bounded.value, "utf8"),
      );
      return redactAndStringify({
        operation,
        stdout: bounded.value,
        truncated: bounded.truncated,
        totalBytes: bounded.totalBytes,
        stderr: result.stderr.slice(0, 20_000),
        exitCode: result.exitCode,
      });
    } catch (error) {
      const failure = wikiGitSandboxFailure(error, session, storeKey);
      if (failure) return failure;
      return sandboxErr(error);
    }
  },
};

/**
 * Resolve (create-or-reuse) the SINGLE shared read-only sbx-git session and
 * return the read-only result message for the agent. All scheduled/automation
 * runs share one session keyed by SBX_GIT.sharedSessionKey, so there is no
 * per-claim snapshot clone (the cause of the rate-limit storm). The session is
 * marked SHARED so the per-conversation ownership check lets any caller use it;
 * mutating tools are stripped from the palette for these runs (see SBX_GIT.disabledTools).
 */
async function resolveSbxGit(requestedRepo: string, context: ToolExecutionContext, reason?: string): Promise<string> {
  const { SBX_GIT, sbxGitResultMessage } = await import("./repo-configs.js");
  const key = SBX_GIT.sharedSessionKey;

  // Operator-selected repo context (agent.config.sbxGitRepos → meta.sbxGitRepos,
  // JSON string array). Advisory scope surfaced to the agent in the result text.
  let focusRepos: string[] | undefined;
  const rawFocus = context.meta?.["sbxGitRepos"];
  if (rawFocus) {
    try {
      const parsed = JSON.parse(rawFocus);
      if (Array.isArray(parsed)) focusRepos = parsed.filter((r): r is string => typeof r === "string");
    } catch { /* malformed → treat as no scope */ }
  }

  // Bind this conversation's storeKey to the shared session too, so the
  // read/grep/find/ls tools (which default to the conversation's session)
  // operate on sbx-git without the agent having to pass the id explicitly.
  const callerKey = storeKeyFromContext(context);
  const bindCaller = (session: Session): void => {
    if (callerKey && callerKey !== key) SESSION_STORE.set(callerKey, session);
  };

  // Reuse the live shared session if present + healthy.
  const existing = SESSION_STORE.get(key);
  if (existing) {
    const alive = await probeSession(existing, key).catch(() => false);
    if (alive) {
      bindCaller(existing);
      return sbxGitResultMessage(requestedRepo, existing.id, focusRepos, reason);
    }
    evictSession(existing, key);
    SHARED_SESSIONS.delete(existing.id);
  }

  // Boot the one shared read-only sandbox (repos are cloned in its prebake).
  try {
    const client = makeClient(context.config, SBX_GIT.template);
    const session = await client.createSession({
      timeoutMs: SBX_GIT.sessionTimeoutMs,
      idleTimeoutMs: idleTimeoutForSessionCreation(context, undefined, 10 * 60 * 1000),
      template: SBX_GIT.template,
    });
    // No owner → shared across conversations; mark it so ownership checks pass.
    rememberSession(key, session, SBX_GIT.template);
    bindCaller(session);
    SHARED_SESSIONS.add(session.id);
    READONLY_SESSIONS.add(session.id);
    await reportExperimentSandboxCreated(context, session, SBX_GIT.template);
    return sbxGitResultMessage(requestedRepo, session.id, focusRepos, reason);
  } catch (err) {
    return sandboxErr(err);
  }
}

// A writable per-repo sandbox couldn't be PROVISIONED. Grounded in the ACTUAL
// prod error (verified in logs): the kata claim never reaches Running —
//   "Error: Timed out waiting for sandbox <name> to reach Running phase."
// plus the codebase's own established transient/backend-unreachable signatures
// (STALE_PATTERNS via isStaleSessionError: could-not-connect-to-backend-sandbox,
// ECONNREFUSED/RESET, socket hang up, sandboxclaim-not-found).
// Deliberately does NOT match user-input errors — "Repository not found",
// "git fetch+checkout ... couldn't find remote ref", "No conversationId in
// context" — those pass through unchanged (no read-only fallback).
function isSandboxProvisioningFailure(result: string): boolean {
  if (!result.startsWith("Error")) return false;
  if (/timed out waiting for sandbox .* to reach running/i.test(result)) return true;
  return isStaleSessionError(new Error(result));
}

export const sandboxRepoSetup: ToolDefinition = {
  slug: "sandbox-repo-setup",
  name: "Sandbox Repository Setup",
  description:
    "Set up a repository workspace. Trusted SDLC repository contexts always receive one write-capable " +
    "workspace, independent of request type. Access capability does not authorize mutation: agents must only " +
    "edit/build/commit when their task explicitly requires implementation. Non-SDLC read-first repositories " +
    "retain their shared read-only default.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      repoName: {
        type: "string",
        description: "Repository name (e.g. 'xyne-spaces', 'hyperswitch'). Must match a key in REPO_CONFIGS.",
      },
      repoId: {
        type: "string",
        description:
          "SDLC repository id, when the run did not start with one pinned. Get it from " +
          "spaces-sdlc-list-repositories; never guess or retype it. Ignored once a repository is already pinned.",
      },
      write: {
        type: "boolean",
        description:
          "For SDLC repository contexts this is normalized to true. For other read-first repositories, " +
          "false uses the shared read-only workspace and true claims a writable workspace.",
      },
      branchName: {
        type: "string",
        description: "Branch to create/checkout. Required only when write=true.",
      },
      sessionDurationMs: {
        type: "number",
        description: "Write-sandbox lifetime in ms (default 1800000 = 30 min; write sandboxes are intentionally short-lived).",
      },
    },
    required: ["repoName"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";

    // Deterministic pin: if the agent is bound to a repo in its config
    // (agent.config.sandboxRepo → context.meta.sandboxRepo), force THAT repo and
    // ignore whatever repoName the LLM passed. This is what makes the setup
    // deterministic — the operator picks the repo in the agent UI, not the model.
    const pinnedRepo = context.meta?.["sandboxRepo"]?.trim();
    const hasSdlcRepositoryMetadata = [
      "sdlcRepositoryId",
      "sdlcRepositoryName",
      "sdlcRepositoryUrl",
      "sdlcRepositoryBaseBranch",
    ].some((key) => context.meta?.[key] !== undefined);
    const sdlcRequired =
      hasSdlcRepositoryMetadata || context.meta?.["requireSdlcRepository"] === "true";
    const selectedRepoId = String(params["repoId"] ?? "").trim();
    if (sdlcRequired && !hasSdlcRepositoryMetadata && selectedRepoId && context.meta) {
      try {
        await resolveSdlcRepositoryIntoMeta(context.meta as Record<string, string>, selectedRepoId);
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const dynamicRepo = resolveDynamicSdlcRepositoryConfig(context);
    if (!dynamicRepo && sdlcRequired) {
      return hasSdlcRepositoryMetadata || selectedRepoId
        ? "Error: Valid SDLC repository context is required; refusing to fall back to a static repository."
        : "Error: No SDLC repository selected. Call spaces-sdlc-list-repositories with this conversation's channelId, then pass the chosen repoId to sandbox-repo-setup.";
    }
    const repoName = dynamicRepo?.name || pinnedRepo || (params["repoName"] as string);
    const wantWrite = Boolean(dynamicRepo) || params["write"] === true;
    const requestedBranchName = params["branchName"] as string;
    const sessionDurationMs = params["sessionDurationMs"] as number | undefined;
    // Import here to avoid circular dependency
    const { REPO_CONFIGS, isReadOnlyJob } = await import("./repo-configs.js");

    // ── Routing ──────────────────────────────────────────────────────────
    // 1. Always-read-only contexts → shared read-only sbx-git (no snapshot
    //    clone): scheduled/automation runs and forceReadOnly (reviewer) agents.
    // `allowWriteInReadOnlyJob` (per-agent opt-in, propagated from
    // agent.config.allowWriteInReadOnlyJob) lets an automation/scheduled run
    // escalate to a writable sandbox on write:true — e.g. the error-pipeline
    // doctor implementing a fix + opening a PR unattended. This is the SAME flag
    // that opts out of the tool-palette stripping in run.ts (processTask); we
    // honor it here too so both halves of read-only enforcement stay in sync
    // (previously it only affected the tool palette, leaving the sandbox routing
    // read-only). It ONLY relaxes the isReadOnlyJob force; `forceReadOnlySandbox`
    // (reviewer agents) still wins unconditionally. Default-off.
    const allowWriteInReadOnlyJob = context.meta?.["allowWriteInReadOnlyJob"] === "true";
    const forcedReadOnly =
      (isReadOnlyJob(context.meta?.["eventType"], context.meta?.["conversationId"]) && !allowWriteInReadOnlyJob) ||
      context.meta?.["forceReadOnlySandbox"] === "true";
    if (forcedReadOnly && !dynamicRepo) {
      return resolveSbxGit(repoName, context);
    }

    let config = dynamicRepo?.config ?? REPO_CONFIGS[repoName];

    // 2. Per-repo READ-FIRST (config.readFirst, e.g. xyne-spaces): default every
    //    interactive run to read-only sbx-git; only claim a writable golden dev
    //    sandbox on explicit write:true. This is what removes the default
    //    snapshot clones that tripped GCP's per-snapshot op-rate limit. Repos
    //    WITHOUT readFirst fall through to legacy behavior (writable clone).
    if (config?.readFirst === true && !wantWrite) {
      return resolveSbxGit(repoName, context);
    }

    // 3. Provision a writable dev sandbox (golden clone). Reached when a
    //    read-first repo asked write:true, OR a non-read-first (legacy) repo.
    if (!config) {
      const availableRepos = Object.keys(REPO_CONFIGS).join(", ");
      return `Error: Repository '${repoName}' not found. Available repos: ${availableRepos}`;
    }
    if (dynamicRepo) {
      const operation = context.meta?.["sdlcRuntimeCredentialOperation"]?.trim();
      const executionId = context.meta?.["sdlcExecutionId"]?.trim();
      const sessionId = context.meta?.["sdlcSessionId"]?.trim();
      const conversationId = context.meta?.["sdlcConversationId"]?.trim();
      const interactiveGrant = context.meta?.["sdlcInteractiveGrant"]?.trim();
      const agentSlug = context.meta?.["agentSlug"]?.trim();
      if (agentSlug !== SDLC_AGENT_SLUG) {
        return "Error: SDLC runtime credentials are restricted to the sdlc-agent profile.";
      }
      if (
        operation === "INTERACTIVE" &&
        interactiveGrant &&
        conversationId &&
        !executionId &&
        !sessionId
      ) {
        config = {
          ...config,
          runtimeCredentialBinding: {
            agentSlug: "sdlc-agent",
            operation,
            interactiveGrant,
            conversationId,
            repoId: dynamicRepo.repoId,
          },
        };
      } else if (
        (operation === "CLONE" || operation === "PUSH") &&
        executionId &&
        sessionId &&
        !interactiveGrant
      ) {
        config = {
          ...config,
          runtimeCredentialBinding: {
            agentSlug: "sdlc-agent",
            operation,
            executionId,
            sessionId,
            repoId: dynamicRepo.repoId,
          },
        };
      } else {
        return "Error: Incomplete SDLC runtime credential grant context.";
      }
    }
    // branchName is now optional in the schema (read-first calls don't pass it).
    // On the writable path, default a missing branch to the repo's defaultBranch
    // so a non-read-first (legacy) repo — or a write:true call that forgot the
    // branch — still provisions cleanly instead of erroring. The agent can cut a
    // feature branch afterwards via sandbox-run before pushing.
    const effectiveBranch = requestedBranchName || config.defaultBranch;
    if (!isSafeGitRef(effectiveBranch)) {
      return "Error: Invalid branch name for SDLC sandbox.";
    }

    // On-demand write sandbox lifetime: per-repo writeSessionTimeoutMs when set
    // (e.g. xyne-spaces = 20 min, to keep concurrent golden-snapshot clones low),
    // else the repo's normal sessionTimeoutMs — so other repos are unchanged.
    const writeSessionMs = sessionDurationMs ?? config.writeSessionTimeoutMs ?? config.sessionTimeoutMs;

    // Short idle release for write sandboxes when configured (xyne-spaces = 10 min):
    // override the repo's idleTimeoutMs so the write sandbox auto-destroys after
    // inactivity. Repos without writeIdleTimeoutMs keep their normal idle behavior.
    const writeConfig = config.writeIdleTimeoutMs
      ? { ...config, idleTimeoutMs: config.writeIdleTimeoutMs }
      : config;

    // Force the correct template for repo setup (override config to avoid warmpool)
    const enhancedContext = {
      ...context,
      config: {
        ...context.config,
        "KATA_TEMPLATE": config.template  // Force the repo's template, bypass warmpool
      }
    };

    // Create a temporary tool using the factory and execute it
    const repoTool = makeRepoSetupTool(writeConfig);
    let result: string;
    try {
      result = await repoTool.execute(
        { branchName: effectiveBranch, ...(writeSessionMs ? { sessionDurationMs: writeSessionMs } : {}) },
        enhancedContext,
      );
    } catch (err) {
      result = sandboxErr(err);
    }

    // Fallback: if the WRITABLE per-repo sandbox could not be provisioned (claim
    // never reached Running / no schedulable warm pod / backend unreachable),
    // serve the repo READ-ONLY from the shared sbx-git sandbox instead of
    // returning "unable to get machine". The agent can still read/grep the code;
    // resolveSbxGit marks the session READ-ONLY so readOnlyGuard rejects any
    // write/run/build against it. Only genuine provisioning failures trigger this
    // — bad-branch / repo-not-found errors pass through unchanged.
    if (isSandboxProvisioningFailure(result)) {
      const firstLine = result.split("\n")[0]?.replace(/^Error:\s*/i, "").slice(0, 160) ?? "provisioning failed";
      // Flag-gated (SANDBOX_UNAVAILABLE_DEFER, default ON; =false restores the
      // old behaviour): instead of silently
      // substituting a read-only session — which lets a write-needing agent
      // "succeed" with an unusable sandbox, conclude it cannot work, and end the
      // run with NO retry signal (forcing a human to re-tag) — emit a stable
      // `sandbox_unavailable` sentinel. custom-tools.ts turns this into a typed
      // SandboxUnavailableError, run.ts ends the run with error:"sandbox_unavailable",
      // and claw-auth run-recovery defers + auto-resumes once a SandboxClaim binds.
      // See apps/xyne-claw/docs/sbx-availability-signal.md.
      if (isSandboxUnavailableDeferEnabled()) {
        return formatSandboxUnavailable(firstLine);
      }
      // SDLC repositories never fall back to a static mirror or sbx-git.
      if (dynamicRepo) return result;
      const reason =
        `the writable dev sandbox could NOT be provisioned right now (${firstLine}) — likely no capacity for a fresh machine.`;
      const ro = await resolveSbxGit(repoName, context, reason);
      // Only substitute the read-only fallback if it actually came up; otherwise
      // return the original provisioning error so the failure isn't masked.
      if (!ro.startsWith("Error")) return ro;
    }
    return result;
  },
};

function isSafeGitRef(value: string): boolean {
  return value.length > 0 && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
    !value.includes("..") && !value.includes("//") && !value.endsWith(".") && !value.endsWith("/");
}

export function resolveDynamicSdlcRepositoryConfig(
  context: ToolExecutionContext,
): { repoId: string; name: string; config: RepoSetupConfig } | null {
  const rawId = context.meta?.["sdlcRepositoryId"]?.trim();
  const rawUrl = context.meta?.["sdlcRepositoryUrl"]?.trim();
  const rawName = context.meta?.["sdlcRepositoryName"]?.trim();
  const baseBranch = context.meta?.["sdlcRepositoryBaseBranch"]?.trim() || "main";
  if (!rawId || !rawUrl || !rawName) return null;
  if (!isSafeGitRef(baseBranch)) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }
  const segments = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length !== 2 || segments.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    return null;
  }
  const name = rawName.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80) || segments[1]!;
  const repoUrl = `https://github.com/${segments[0]}/${segments[1]}.git`;
  return {
    repoId: rawId,
    name,
    config: {
      slug: "sandbox-sdlc-repository-setup",
      name: `SDLC repository: ${name}`,
      description: "Run-scoped public GitHub repository attached to an SDLC hub.",
      repoUrl,
      defaultBranch: baseBranch,
      ...(context.meta?.["sdlcWikiRun"] === "true"
        ? {
            cloneFilter: "blob:none" as const,
            cloneSingleBranch: true,
            cloneTimeoutMs: 30 * 60 * 1000,
          }
        : { cloneDepth: 1 }),
      workDir: `/workspace/${name}`,
      template: "kata-workspace-template",
      sessionTimeoutMs: 60 * 60 * 1000,
      idleTimeoutMs: 20 * 60 * 1000,
      readyTimeoutMs: 10 * 60 * 1000,
      steps: [],
      skipBakedCloneWait: true,
    },
  };
}

/**
 * Destroy a sandbox session and free its resources.
 */
export const sandboxDestroy: ToolDefinition = {
  slug: "sandbox-destroy",
  name: "Sandbox Destroy Session",
  description: "Destroy a sandbox session and free all associated resources. Always call this when done.",
  source: "custom:sandbox",
  configSchema: SANDBOX_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID returned by sandbox-create",
      },
    },
    required: ["sessionId"],
  },

  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const sessionId = params["sessionId"] as string;
    const storeKey = storeKeyFromContext(context);

    const lookupKey = SESSION_STORE.has(sessionId) ? sessionId : storeKey;
    const session = SESSION_STORE.get(sessionId) ?? (storeKey ? SESSION_STORE.get(storeKey) : undefined);
    if (!session) return `Error: Session ${sessionId} not found or already destroyed.`;
    if (!isSessionOwnedByContext(session, lookupKey, context)) {
      return unauthorizedSessionMessage(sessionId);
    }
    const roDestroy = readOnlyGuard(session, { destroy: true });
    if (roDestroy) return roDestroy;

    let destroyError: string | undefined;
    try {
      await cleanupSdlcGitCredentialMaterial(session).catch(() => undefined);
      await session.destroy();
    } catch (err) {
      destroyError = err instanceof Error ? err.message : String(err);
    }
    evictSession(session, storeKey);
    if (destroyError) {
      return JSON.stringify({ sessionId, destroyed: false, evicted: true, error: destroyError });
    }
    return JSON.stringify({ sessionId, destroyed: true });
  },
};
