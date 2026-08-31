/**
 * Bitbucket Server stats service for the admin dashboard.
 *
 * Counts pull requests and commits authored by a configured Bitbucket user
 * (defaults to `john.doe@gmail.com`, the bot identity that all sandbox
 * commits and doctor-agent PRs flow through). Counts are cached in-memory for
 * `CONFIG.bitbucketDashboardCacheTtlMs` (default 15 minutes) so the dashboard
 * doesn't hammer Bitbucket on every page load, and an optional background
 * refresh keeps the cache warm so the first user request never pays the
 * cold-fetch latency.
 *
 * No write operations and no MCP tool calls — this is a plain server-to-server
 * read using HTTP Basic auth with a stored bot token. The token only needs
 * REPO_READ on the configured project/repo.
 *
 * If `BITBUCKET_DASHBOARD_TOKEN` is unset, every call returns
 * `{ prsCreated: null, commitsCreated: null, reason: "bitbucket_token_missing" }`
 * so the dashboard can render a friendly empty state.
 */

import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";

import { createLogger } from "../logger.js";
const log = createLogger("bitbucket-stats");

export interface DoctorBitbucketStats {
  prsCreated: number | null;
  commitsCreated: number | null;
  authorEmail: string;
  authorUsername: string;
  projectKey: string;
  repoSlug: string;
  baseUrl: string;
  lastRefreshedAt: string | null;
  reason?: "bitbucket_token_missing" | "fetch_failed";
  errorMessage?: string;
}

interface CacheEntry {
  prsCreated: number;
  commitsCreated: number;
  lastRefreshedAt: string;
  expiresAt: number;
}

interface BitbucketPagedResponse<T> {
  size?: number;
  limit?: number;
  isLastPage?: boolean;
  start?: number;
  nextPageStart?: number | null;
  values?: T[];
}

interface BitbucketPrUser {
  emailAddress?: string;
  name?: string;
  slug?: string;
}

interface BitbucketPrAuthor {
  user?: BitbucketPrUser;
}

interface BitbucketPullRequest {
  id?: number;
  state?: string;
  author?: BitbucketPrAuthor;
}

interface BitbucketCommit {
  id?: string;
  displayId?: string;
  author?: {
    emailAddress?: string;
    name?: string;
  };
  committer?: {
    emailAddress?: string;
    name?: string;
  };
}

const PAGE_SIZE = 100;
// Hard safety ceiling per paginated list.
const MAX_PAGES = 200;

let cache: CacheEntry | null = null;
let inFlight: Promise<CacheEntry> | null = null;
let backgroundTimer: NodeJS.Timeout | null = null;

/**
 * Build the Authorization header. When `BITBUCKET_DASHBOARD_USERNAME` is set
 * we send HTTP Basic auth (legacy / matches the rest of the codebase's MCP
 * adapter pattern). When only the token is set we send Bearer auth, which is
 * Bitbucket Server's native protocol for HTTP Access Tokens — the token alone
 * is sufficient and we don't need to know the owner's username. Bearer is
 * also more forgiving when the token belongs to a different user than the
 * one whose data we're querying (which is the common case here: e.g. you
 * generate a token under `rahul.kumar` to count `xyne.spaces` activity).
 */
function authHeader(): string {
  const username = CONFIG.bitbucketDashboardUsername;
  const token = CONFIG.bitbucketDashboardToken;
  if (username) {
    return "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
  }
  return `Bearer ${token}`;
}

function baseRepoUrl(): string {
  return `${CONFIG.bitbucketDashboardBaseUrl}/rest/api/1.0/projects/${encodeURIComponent(
    CONFIG.bitbucketDashboardProjectKey,
  )}/repos/${encodeURIComponent(CONFIG.bitbucketDashboardRepoSlug)}`;
}

async function fetchPage<T>(url: string): Promise<BitbucketPagedResponse<T>> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Bitbucket REST ${res.status} ${res.statusText} on ${url} — ${errBody.slice(0, 200)}`,
    );
  }
  return (await res.json()) as BitbucketPagedResponse<T>;
}

/**
 * Paginate ALL pull requests in the repo and count those whose author matches
 * the configured identity. We do NOT use Bitbucket's `role=AUTHOR&username=`
 * query params because on this Bitbucket Server version those params are
 * silently ignored — the endpoint returns every PR regardless, so the only
 * reliable approach is client-side filtering.
 */
async function fetchPrCountByAuthor(): Promise<number> {
  const authorEmail = CONFIG.bitbucketDashboardAuthorEmail.toLowerCase();
  const authorSlug = CONFIG.bitbucketDashboardAuthorUsername.toLowerCase();
  let start = 0;
  let count = 0;
  // `exhaustedCap` stays true if we exit only because MAX_PAGES was reached
  // — i.e. the repo had more PRs than our scan window. Surfacing that as a
  // warn line so a silent under-count isn't invisible in dashboards.
  let exhaustedCap = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseRepoUrl()}/pull-requests?state=ALL&limit=${PAGE_SIZE}&start=${start}`;
    const body = await fetchPage<BitbucketPullRequest>(url);
    const values = body.values ?? [];
    for (const pr of values) {
      const email = pr.author?.user?.emailAddress?.toLowerCase();
      const slug = pr.author?.user?.slug?.toLowerCase();
      if (email === authorEmail || slug === authorSlug) count++;
    }
    if (body.isLastPage || values.length === 0) { exhaustedCap = false; break; }
    if (typeof body.nextPageStart === "number") {
      start = body.nextPageStart;
    } else {
      start += values.length;
    }
  }
  if (exhaustedCap) {
    log.warn(
      `[bitbucket-stats] PR scan capped at MAX_PAGES=${MAX_PAGES} (${MAX_PAGES * PAGE_SIZE} PRs) — count may under-report. Raise MAX_PAGES or narrow the date range.`,
    );
  }
  return count;
}

/**
 * Paginate the default branch commit log and count commits whose
 * author.emailAddress matches the configured identity.
 * Note: this counts only commits visible on the default branch (main).
 * Commits on feature branches that were squash-merged will not be included.
 */
async function fetchCommitCountByAuthor(): Promise<number> {
  const authorEmail = CONFIG.bitbucketDashboardAuthorEmail.toLowerCase();
  let start = 0;
  let count = 0;
  // Same MAX_PAGES-exhaustion warning as fetchPrCountByAuthor — visibility
  // when the default-branch commit log exceeds our scan window.
  let exhaustedCap = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseRepoUrl()}/commits?limit=${PAGE_SIZE}&start=${start}`;
    const body = await fetchPage<BitbucketCommit>(url);
    const values = body.values ?? [];
    for (const commit of values) {
      const email = commit.author?.emailAddress?.toLowerCase();
      if (email === authorEmail) count++;
    }
    if (body.isLastPage || values.length === 0) { exhaustedCap = false; break; }
    start = typeof body.nextPageStart === "number" ? body.nextPageStart : start + values.length;
  }
  if (exhaustedCap) {
    log.warn(
      `[bitbucket-stats] commit scan capped at MAX_PAGES=${MAX_PAGES} (${MAX_PAGES * PAGE_SIZE} commits) — count may under-report. Raise MAX_PAGES or narrow the branch range.`,
    );
  }
  return count;
}

async function refreshNow(): Promise<CacheEntry> {
  const startedAt = Date.now();
  const [prsCreated, commitsCreated] = await Promise.all([
    fetchPrCountByAuthor(),
    fetchCommitCountByAuthor(),
  ]);
  const lastRefreshedAt = new Date().toISOString();
  const entry: CacheEntry = {
    prsCreated,
    commitsCreated,
    lastRefreshedAt,
    expiresAt: Date.now() + CONFIG.bitbucketDashboardCacheTtlMs,
  };
  cache = entry;
  log.info(
    `[bitbucket-stats] refreshed prs=${prsCreated} commits=${commitsCreated} in ${
      Date.now() - startedAt
    }ms`,
  );
  return entry;
}

function envelope(
  entry: CacheEntry | null,
  reason?: DoctorBitbucketStats["reason"],
  errorMessage?: string,
): DoctorBitbucketStats {
  const base: DoctorBitbucketStats = {
    prsCreated: entry?.prsCreated ?? null,
    commitsCreated: entry?.commitsCreated ?? null,
    authorEmail: CONFIG.bitbucketDashboardAuthorEmail,
    authorUsername: CONFIG.bitbucketDashboardAuthorUsername,
    projectKey: CONFIG.bitbucketDashboardProjectKey,
    repoSlug: CONFIG.bitbucketDashboardRepoSlug,
    baseUrl: CONFIG.bitbucketDashboardBaseUrl,
    lastRefreshedAt: entry?.lastRefreshedAt ?? null,
  };
  if (reason) base.reason = reason;
  if (errorMessage) base.errorMessage = errorMessage;
  return base;
}

export function isBitbucketDashboardConfigured(): boolean {
  // Token alone is enough — without a username we fall back to Bearer auth.
  return Boolean(CONFIG.bitbucketDashboardToken);
}

/**
 * Returns the cached counts if fresh, otherwise triggers a refresh and waits
 * for it. Concurrent callers share the same in-flight refresh promise so a
 * traffic spike doesn't fan out N parallel Bitbucket scans.
 */
export async function getDoctorBitbucketStats(): Promise<DoctorBitbucketStats> {
  if (!isBitbucketDashboardConfigured()) {
    return envelope(null, "bitbucket_token_missing");
  }
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return envelope(cache);
  }
  if (!inFlight) {
    inFlight = refreshNow().finally(() => {
      inFlight = null;
    });
  }
  try {
    const entry = await inFlight;
    return envelope(entry);
  } catch (err) {
    const msg = errMsg(err);
    log.error("[bitbucket-stats] refresh failed:", msg);
    // Serve stale cache if available so the dashboard isn't a black hole during
    // a transient Bitbucket outage.
    if (cache) return envelope(cache, "fetch_failed", msg);
    return envelope(null, "fetch_failed", msg);
  }
}

/**
 * Schedule a once-per-day background refresh at 2 AM IST (20:30 UTC). The 566+
 * PR + 49+ commit scan loads multi-MB payloads into memory and was running
 * every 15 minutes in the periodic-refresh era — contributed to the 2 GB heap
 * OOMs in prod (2026-05-20). Daily off-hours run keeps the cache warm enough
 * for the next morning while leaving the heap quiet during user traffic.
 *
 * On-demand fetches still happen if the cache is stale when a user hits the
 * endpoint (see the TTL check in getDoctorBitbucketStats).
 *
 * Safe to call multiple times — no-op if already scheduled or disabled.
 */
export function startBitbucketStatsBackgroundRefresh(): void {
  if (backgroundTimer) return;
  if (!CONFIG.bitbucketDashboardBackgroundRefresh) return;
  if (!isBitbucketDashboardConfigured()) {
    log.info(
      "[bitbucket-stats] background refresh disabled — BITBUCKET_DASHBOARD_TOKEN unset",
    );
    return;
  }
  log.info("[bitbucket-stats] background refresh scheduled daily at 2 AM IST (20:30 UTC)");
  scheduleNextDailyRefresh();
}

function scheduleNextDailyRefresh(): void {
  const now = new Date();
  const nextRunUTC = new Date(now);
  nextRunUTC.setUTCHours(20, 30, 0, 0);
  if (nextRunUTC <= now) {
    nextRunUTC.setUTCDate(nextRunUTC.getUTCDate() + 1);
  }
  const msUntilRun = nextRunUTC.getTime() - now.getTime();
  log.info(
    `[bitbucket-stats] next refresh at ${nextRunUTC.toISOString()} (in ${msUntilRun}ms)`,
  );
  backgroundTimer = setTimeout(async () => {
    try {
      await refreshNow();
    } catch (err) {
      const msg = errMsg(err);
      log.error("[bitbucket-stats] daily refresh failed:", msg);
    } finally {
      backgroundTimer = null;
      scheduleNextDailyRefresh();
    }
  }, msUntilRun);
  backgroundTimer.unref?.();
}

export function stopBitbucketStatsBackgroundRefresh(): void {
  if (backgroundTimer) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
}
