/**
 * Bitbucket call throttle + backoff + real-status classification.
 *
 * Why: Bitbucket Server rate-limits PER TOKEN. A single user firing hundreds of
 * PR/diff calls concurrently (e.g. the pr-pattern-extractor subagent mining
 * 1300 PRs) trips THEIR token's limit. The upstream `@nexus2520/bitbucket-mcp-
 * server` then collapses EVERY non-2xx response — 403 (permission), 429 (rate
 * limit), 401 — into the same misleading string: "Permission denied … Ensure
 * your credentials have the necessary permissions." So a rate-limit storm reads
 * as "no access to ~1100 PRs" when the token actually has access.
 *
 * This wrapper, applied to all `bitbucket` tool calls:
 *   (a) THROTTLE: caps per-user concurrency + spaces out call starts, so a
 *       burst never trips the token's limit in the first place.
 *   (b) BACKOFF + REAL STATUS: on error, probes Bitbucket once for the actual
 *       HTTP status. 403 → genuine permission, fail fast with a clear message.
 *       429/unknown → back off and retry. Exhausted 429 → report it AS a rate
 *       limit, not "permission denied".
 */
import { callTool } from "./runner.js";
import { errMsg } from "../lib/errors.js";
import type { McpCallResult } from "./types.js";

const MAX_CONCURRENT_PER_USER = Number(process.env["BITBUCKET_MAX_CONCURRENCY"] ?? 2);
const MIN_INTERVAL_MS = Number(process.env["BITBUCKET_MIN_INTERVAL_MS"] ?? 300);
const MAX_RETRIES = Number(process.env["BITBUCKET_MAX_RETRIES"] ?? 3);
const PROBE_TIMEOUT_MS = 8_000;

interface UserGate {
  active: number;
  queue: Array<() => void>;
  /** Wall-clock ms before which the next call for this user may not START. */
  nextAllowedStart: number;
}

const gates = new Map<string, UserGate>();

function getGate(userId: string): UserGate {
  let g = gates.get(userId);
  if (!g) {
    g = { active: 0, queue: [], nextAllowedStart: 0 };
    gates.set(userId, g);
  }
  return g;
}

/** Run `fn` under the user's concurrency cap + rate spacing. */
async function withGate<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const g = getGate(userId);
  if (g.active >= MAX_CONCURRENT_PER_USER) {
    await new Promise<void>((resolve) => g.queue.push(resolve));
  }
  g.active++;
  try {
    const wait = Math.max(0, g.nextAllowedStart - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    g.nextAllowedStart = Date.now() + MIN_INTERVAL_MS;
    return await fn();
  } finally {
    g.active = Math.max(0, g.active - 1);
    const next = g.queue.shift();
    if (next) next();
  }
}

/**
 * Read the REAL Bitbucket HTTP status for a failed call, since the MCP server
 * hides it. Parses project/repo/prId out of the upstream error string
 * ("… for pull request 529 in PICAF/arya") and does one lightweight GET.
 * Returns the status code, or null if it can't be determined.
 */
async function probeBitbucketStatus(
  credentials: Record<string, unknown>,
  errorMsg: string,
): Promise<number | null> {
  const m = errorMsg.match(/pull request (\d+) in ([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/);
  if (!m) return null;
  const [, prId, project, repo] = m;
  const username = credentials["username"] as string | undefined;
  const token = credentials["token"] as string | undefined;
  if (!username || !token) return null;
  const baseUrl = ((credentials["baseUrl"] as string) || "https://bitbucket.juspay.net").replace(/\/+$/, "");
  const url = `${baseUrl}/rest/api/1.0/projects/${project}/repos/${repo}/pull-requests/${prId}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Basic " + Buffer.from(`${username}:${token}`).toString("base64") },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Throttled, retrying, status-aware bitbucket tool call. Drop-in replacement
 * for `callTool(userId, "bitbucket", …)` in the mcp/call forward path.
 */
export async function callBitbucketThrottled(
  userId: string,
  credentials: Record<string, unknown>,
  tool: string,
  params: Record<string, unknown>,
  agentSlug?: string,
): Promise<McpCallResult> {
  return withGate(userId, async () => {
    let probedStatus: number | null | undefined; // undefined = not yet probed
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await callTool(userId, "bitbucket", credentials, tool, params, agentSlug);
      } catch (err) {
        lastErr = err;
        const msg = errMsg(err);

        // Only the generic "Permission denied" string hides the real status —
        // anything else is already specific, so don't retry/probe it.
        if (!/permission denied/i.test(msg)) throw err;

        // Probe the true status once, on the first error.
        if (probedStatus === undefined) {
          probedStatus = await probeBitbucketStatus(credentials, msg);
        }

        if (probedStatus === 403 || probedStatus === 401) {
          // Genuine auth/permission failure — retrying won't help.
          throw new Error(
            `Bitbucket ${probedStatus} (genuine ${probedStatus === 401 ? "unauthorized" : "permission denied"}) for ${tool}: ${msg}`,
          );
        }

        // 429, 5xx, or unknown — treat as transient/rate-limit and back off.
        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new Error(
          probedStatus === 429
            ? `Bitbucket 429 (RATE LIMITED — not a permission problem) for ${tool} after ${MAX_RETRIES} retries. Reduce concurrency / batch size and back off.`
            : `Bitbucket call failed for ${tool} after ${MAX_RETRIES} retries (status=${probedStatus ?? "unknown"}): ${msg}`,
        );
      }
    }
    throw lastErr;
  });
}
