/**
 * GitHub growth & audience tools.
 *
 * The upstream `@modelcontextprotocol/server-github` toolset covers repos,
 * issues, PRs and files — it exposes NOTHING about how a repository is
 * actually doing: stars, traffic, forks, release downloads, contributor
 * activity. These tools fill that gap.
 *
 * Every tool here is READ-ONLY and executes locally in claw-auth against the
 * connection's PAT, exactly like `upload-pr-attachment`: the token is
 * decrypted per call and never leaves this process. No entry is needed in the
 * github `writeToolPolicy` because nothing here mutates GitHub state.
 *
 * Registration lives in routes/mcp.ts — CUSTOM_TOOL_INJECTIONS lists them so
 * the agent can see them, and the /mcp/call dispatch routes them here.
 *
 * Two constraints shape the whole file:
 *
 *  1. **Context budget.** 100 full GitHub user objects is ~40 KB of JSON. Every
 *     tool returns compact rows plus pre-computed aggregates, and the raw
 *     shapes stay behind an opt-in flag. The agent should never be doing
 *     arithmetic over a 52-element array we could have reduced for it.
 *  2. **No silent truncation.** Anything that paginates reports `complete`,
 *     and any cap that bit is named in the payload (`truncatedByMax`,
 *     `sampledIssues`, …) rather than quietly shrinking the answer.
 */
import type { McpToolInfo } from "../types.js";
import type { Citation } from "xyne-claw-shared";
import { prefixChunk } from "./grafana.js";
import { pathSegment } from "../../lib/url-path.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = `${GITHUB_API}/graphql`;
/** Matches GITHUB_API_VERSION in github.ts — keep the two in step. */
const API_VERSION = "2026-03-10";
const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

/**
 * Runaway guard on any page walk. GitHub also refuses to paginate list
 * endpoints indefinitely — deep pages on /stargazers have historically started
 * erroring around page 400 — so a repo past this is reported as
 * `complete: false` with an explicit note instead of a truncated list that
 * reads like the whole set.
 */
const MAX_PAGES = 400;

// ── HTTP client ─────────────────────────────────────────────────────────────

interface GhRequestOptions {
  accept?: string;
  method?: string;
  body?: string;
  timeoutMs?: number;
  /** Extra sentence appended to a 403 — say which token permission is missing. */
  forbiddenHint?: string;
  /** 404 resolves to null instead of throwing (optional/unavailable endpoint). */
  allow404?: boolean;
  /** 202 resolves to null instead of throwing (GitHub still computing stats). */
  allow202?: boolean;
}

/**
 * Thin GitHub REST/GraphQL client with the error messages this surface needs.
 *
 * The point of the class (over a bare fetch helper) is `rateLimitNote()`: one
 * PAT is shared by every agent on the connection, and an enrichment loop that
 * quietly eats 4000 requests starves every other GitHub tool in the org. Each
 * handler surfaces the remaining budget when it gets low.
 */
export class GhClient {
  private remaining: number | null = null;
  private limit: number | null = null;
  private resetAtMs: number | null = null;
  private requests = 0;
  private searchRequests = 0;

  constructor(
    private readonly token: string,
    private readonly tool: string,
  ) {
    if (!token || typeof token !== "string") {
      throw new Error(`${tool}: the GitHub connection has no token configured`);
    }
  }

  get requestCount(): number {
    return this.requests;
  }

  private headers(accept: string, hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      "User-Agent": "xyne-spaces",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (hasBody) h["Content-Type"] = "application/json";
    return h;
  }

  private absorbRateHeaders(res: Response): void {
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const limit = Number(res.headers.get("x-ratelimit-limit"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    // Search has its own much smaller bucket; don't let it overwrite the core
    // budget reading, which is what callers actually need to pace against.
    const isSearchBucket = Number.isFinite(limit) && limit > 0 && limit <= 30;
    if (Number.isFinite(remaining) && !isSearchBucket) this.remaining = remaining;
    if (Number.isFinite(limit) && !isSearchBucket) this.limit = limit;
    if (Number.isFinite(reset) && reset > 0 && !isSearchBucket) this.resetAtMs = reset * 1000;
  }

  /** Raw request. Throws a mapped Error on any non-2xx the caller didn't allow. */
  async request(url: string, opts: GhRequestOptions = {}): Promise<Response | null> {
    if (url.includes("/search/")) this.searchRequests += 1;
    this.requests += 1;

    const init: RequestInit = {
      method: opts.method ?? "GET",
      headers: this.headers(opts.accept ?? "application/vnd.github+json", opts.body !== undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
    if (opts.body !== undefined) init.body = opts.body;

    const res = await fetch(url, init);
    this.absorbRateHeaders(res);

    // 202 is inside the 2xx range but carries NO body — GitHub is still
    // computing the stats. It has to be caught before the `res.ok` fast path
    // or the caller gets a JSON parse error instead of a retry.
    if (res.status === 202 && opts.allow202) return null;
    if (res.ok) return res;
    if (res.status === 404 && opts.allow404) return null;

    const text = await res.text().catch(() => "");
    throw new Error(this.mapError(res, text, opts));
  }

  private mapError(res: Response, body: string, opts: GhRequestOptions): string {
    const snippet = body.slice(0, 300);
    if (res.status === 401) {
      return `${this.tool}: GitHub rejected the connected token (401) — the PAT is invalid, revoked or expired. Re-connect GitHub with a fresh token.`;
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const when = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : "shortly";
        return `${this.tool}: GitHub rate limit exhausted for this PAT. It resets at ${when} — retry after that, or narrow the request (lower \`max\`, turn off \`enrich\`).`;
      }
      if (/secondary rate/i.test(body)) {
        return `${this.tool}: hit GitHub's secondary rate limit (too many requests in a burst). Retry in a minute with a smaller \`max\`.`;
      }
      const hint = opts.forbiddenHint ? ` ${opts.forbiddenHint}` : "";
      return `${this.tool}: GitHub returned 403 for this request.${hint} (${snippet})`;
    }
    if (res.status === 404) {
      return `${this.tool}: not found (404) — either the repository does not exist or the connected PAT cannot see it. Private repos need a token with access to them.`;
    }
    if (res.status === 422) {
      return `${this.tool}: GitHub rejected the request (422) — this is usually pagination depth or an unsupported filter. ${snippet}`;
    }
    return `${this.tool}: GitHub API error (${res.status}): ${snippet}`;
  }

  /** GET + parse JSON. Returns null when an allowed 404/202 was hit. */
  async json<T>(url: string, opts: GhRequestOptions = {}): Promise<T | null> {
    const res = await this.request(url, opts);
    if (!res) return null;
    return (await res.json()) as T;
  }

  /** GET + parse JSON, also handing back the Response for its Link header. */
  async jsonWithRes<T>(url: string, opts: GhRequestOptions = {}): Promise<{ data: T; res: Response } | null> {
    const res = await this.request(url, opts);
    if (!res) return null;
    return { data: (await res.json()) as T, res };
  }

  /**
   * A `/stats/*` endpoint answers 202 the first time it is asked while GitHub
   * computes the numbers in the background. Poll a few times rather than
   * handing the agent an empty series it will read as "no activity".
   */
  async statsWithRetry<T>(url: string, attempts = 4): Promise<T | null> {
    const waits = [1_500, 3_000, 5_000];
    for (let i = 0; i < attempts; i++) {
      const data = await this.json<T>(url, { allow202: true, allow404: true });
      if (data !== null) return data;
      const wait = waits[Math.min(i, waits.length - 1)] ?? 5_000;
      if (i < attempts - 1) await sleep(wait);
    }
    return null;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<{ data?: T; errors?: Array<{ message?: string }> }> {
    const res = await this.request(GITHUB_GRAPHQL, {
      method: "POST",
      body: JSON.stringify({ query, variables }),
      accept: "application/json",
      timeoutMs: 45_000,
    });
    if (!res) return {};
    return (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  }

  /** Non-null only when the budget is low enough that the agent should care. */
  rateLimitNote(): string | null {
    if (this.remaining === null) return null;
    if (this.remaining > 500) return null;
    const reset = this.resetAtMs ? new Date(this.resetAtMs).toISOString() : "unknown";
    return `GitHub rate limit running low: ${this.remaining}/${this.limit ?? "?"} core requests left on this PAT (resets ${reset}). This call used ${this.requests}.`;
  }

  get searchRequestCount(): number {
    return this.searchRequests;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── generic helpers ─────────────────────────────────────────────────────────

/** Validate + encode an owner/repo pair, returning both raw and URL-safe forms. */
function repoRef(tool: string, params: Record<string, unknown>): {
  owner: string;
  repo: string;
  safeOwner: string;
  safeRepo: string;
  slug: string;
  base: string;
} {
  const owner = (params["owner"] as string | undefined)?.trim();
  const repo = (params["repo"] as string | undefined)?.trim();
  if (!owner || !repo) throw new Error(`${tool}: owner and repo are required`);
  const safeOwner = pathSegment(`${tool}: owner`, owner);
  const safeRepo = pathSegment(`${tool}: repo`, repo);
  return {
    owner,
    repo,
    safeOwner,
    safeRepo,
    slug: `${owner}/${repo}`,
    base: `${GITHUB_API}/repos/${safeOwner}/${safeRepo}`,
  };
}

/** Split "owner/repo" (as accepted by github-compare-repos) into a repoRef. */
function repoRefFromSlug(tool: string, slug: unknown): ReturnType<typeof repoRef> {
  const raw = typeof slug === "string" ? slug.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "") : "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`${tool}: '${String(slug)}' is not in owner/repo form`);
  return repoRef(tool, { owner: parts[0], repo: parts[1] });
}

/** `Link: <url>; rel="last"` → 400. Null when the header has no such rel. */
export function pageFromLink(linkHeader: string | null, rel: string): number | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (!match || match[2] !== rel) continue;
    const pageParam = /[?&]page=(\d+)/.exec(match[1] ?? "");
    if (pageParam?.[1]) return Number(pageParam[1]);
  }
  return null;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  if (typeof value === "string" && value.trim()) return value.split(",").map((v) => v.trim()).filter(Boolean);
  return [];
}

/** Accepts `2026-09-01` or a full ISO timestamp. Throws on garbage rather than silently ignoring the filter. */
function isoDate(tool: string, label: string, value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${tool}: ${label} must be an ISO date string (YYYY-MM-DD)`);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00Z` : value.trim());
  if (!Number.isFinite(ms)) throw new Error(`${tool}: ${label}='${value}' is not a parsable date — use YYYY-MM-DD`);
  return ms;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Count occurrences, keeping the first-seen spelling as the display value. */
function topCounts(values: Array<string | null | undefined>, limit: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, { display: string; count: number }>();
  for (const raw of values) {
    if (!raw) continue;
    const display = raw.replace(/\s+/g, " ").trim();
    if (!display) continue;
    const key = display.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { display, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, limit)
    .map((e) => ({ value: e.display, count: e.count }));
}

/** `@Juspay `, `Juspay Technologies` → a comparable company key. */
function normalizeCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^@+/, "").replace(/[.,]+$/, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** One-line headline + JSON body: the token stays clickable, the JSON stays parsable. */
function cited(headline: string, manifest: Record<string, unknown>, citations: Citation[]): { content: string; citations?: Citation[] } {
  const content = `${prefixChunk(1, headline)}\n\n${JSON.stringify(manifest, null, 2)}`;
  return citations.length > 0 ? { content, citations } : { content };
}

function repoCitation(owner: string, repo: string, path: string, label: string): Citation {
  return {
    kind: "external",
    url: `https://github.com/${owner}/${repo}${path}`,
    chunkIndex: 1,
    label,
  };
}

// ── stargazers ──────────────────────────────────────────────────────────────

interface RestUser {
  login?: string;
  type?: string;
  html_url?: string;
  site_admin?: boolean;
  name?: string | null;
  company?: string | null;
  location?: string | null;
  bio?: string | null;
  blog?: string | null;
  email?: string | null;
  twitter_username?: string | null;
  followers?: number;
  following?: number;
  public_repos?: number;
  created_at?: string;
  hireable?: boolean | null;
}

/** `application/vnd.github.star+json` wraps the user and adds the timestamp. */
interface RestStargazer {
  starred_at?: string;
  user?: RestUser;
}

export interface StargazerRow {
  login: string;
  starredAt: string | null;
  profileUrl: string;
  type: string;
}

export interface Profile {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  bio: string | null;
  blog: string | null;
  twitter: string | null;
  email: string | null;
  followers: number | null;
  following: number | null;
  publicRepos: number | null;
  createdAt: string | null;
  hireable: boolean | null;
}

interface StargazerFetch {
  rows: StargazerRow[];
  /** TRUE only when this is the entire matching set, not a `max`-limited prefix. */
  complete: boolean;
  truncatedByMax: boolean;
  pagesWalked: number;
  lastPage: number | null;
  notes: string[];
}

const STAR_ACCEPT = "application/vnd.github.star+json";

function stargazerRow(entry: RestStargazer): StargazerRow | null {
  const user = entry.user;
  const login = user?.login;
  if (!login) return null;
  return {
    login,
    starredAt: entry.starred_at ?? null,
    profileUrl: user?.html_url ?? `https://github.com/${login}`,
    type: user?.type ?? "User",
  };
}

/**
 * Walk /stargazers with the star media type.
 *
 * The one thing that makes this non-trivial: **GitHub returns stargazers
 * oldest-first**, and the endpoint has no sort parameter. "Who starred us this
 * week" therefore means starting at the LAST page and walking backwards, which
 * is what `order: "newest"` does here. Reading page 1 and calling it recent is
 * the single most common way this gets built wrong.
 */
export async function fetchStargazers(
  gh: GhClient,
  tool: string,
  ref: { base: string },
  opts: { order: "newest" | "oldest"; max: number; sinceMs: number | null; untilMs: number | null },
): Promise<StargazerFetch> {
  const notes: string[] = [];
  const url = (page: number) => `${ref.base}/stargazers?per_page=${PAGE_SIZE}&page=${page}`;

  const first = await gh.jsonWithRes<RestStargazer[]>(url(1), { accept: STAR_ACCEPT });
  if (!first) return { rows: [], complete: true, truncatedByMax: false, pagesWalked: 0, lastPage: null, notes };

  const lastPage = pageFromLink(first.res.headers.get("link"), "last") ?? 1;
  const firstRows = (Array.isArray(first.data) ? first.data : []).map(stargazerRow).filter((r): r is StargazerRow => r !== null);

  const inWindow = (row: StargazerRow): boolean => {
    if (!row.starredAt) return opts.sinceMs === null && opts.untilMs === null;
    const ms = Date.parse(row.starredAt);
    if (!Number.isFinite(ms)) return true;
    if (opts.sinceMs !== null && ms < opts.sinceMs) return false;
    if (opts.untilMs !== null && ms > opts.untilMs) return false;
    return true;
  };

  const collected: StargazerRow[] = [];
  let pagesWalked = 1;
  let exhausted = false;

  if (opts.order === "oldest") {
    for (const row of firstRows) {
      if (inWindow(row)) collected.push(row);
      if (collected.length >= opts.max) break;
    }
    exhausted = lastPage === 1;
    let page = 2;
    while (collected.length < opts.max && page <= lastPage && pagesWalked < MAX_PAGES) {
      const data = (await gh.json<RestStargazer[]>(url(page), { accept: STAR_ACCEPT })) ?? [];
      pagesWalked += 1;
      const rows = data.map(stargazerRow).filter((r): r is StargazerRow => r !== null);
      for (const row of rows) {
        // Ascending order: once we pass `until`, every later star is later still.
        if (opts.untilMs !== null && row.starredAt && Date.parse(row.starredAt) > opts.untilMs) {
          exhausted = true;
          break;
        }
        if (inWindow(row)) collected.push(row);
        if (collected.length >= opts.max) break;
      }
      if (exhausted) break;
      if (rows.length === 0 || page === lastPage) { exhausted = true; break; }
      page += 1;
    }
  } else {
    // Newest-first: walk backwards from the last page. Page 1 is already in
    // hand, so reuse it when the repo is small enough to fit on one page.
    const pageCache = new Map<number, StargazerRow[]>([[1, firstRows]]);
    let page = lastPage;
    while (collected.length < opts.max && page >= 1 && pagesWalked <= MAX_PAGES) {
      let rows = pageCache.get(page);
      if (!rows) {
        const data = (await gh.json<RestStargazer[]>(url(page), { accept: STAR_ACCEPT })) ?? [];
        pagesWalked += 1;
        rows = data.map(stargazerRow).filter((r): r is StargazerRow => r !== null);
      }
      let pageFullyBeforeSince = rows.length > 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (!row) continue;
        const ms = row.starredAt ? Date.parse(row.starredAt) : NaN;
        if (opts.sinceMs !== null && Number.isFinite(ms) && ms >= opts.sinceMs) pageFullyBeforeSince = false;
        if (inWindow(row)) {
          collected.push(row);
          pageFullyBeforeSince = false;
        }
        if (collected.length >= opts.max) break;
      }
      // Every star on this page predates `since`, and pages only get older
      // going down — the filtered set is fully enumerated.
      if (pageFullyBeforeSince && opts.sinceMs !== null) { exhausted = true; break; }
      if (page === 1) { exhausted = true; break; }
      page -= 1;
    }
  }

  if (lastPage > MAX_PAGES) {
    notes.push(
      `This repo has ~${lastPage} pages of stargazers; the walk is capped at ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} stars) because GitHub stops paginating past roughly that depth. Use github-star-history for totals over the full lifetime.`,
    );
  }

  const truncatedByMax = collected.length >= opts.max && !exhausted;
  return { rows: collected, complete: exhausted && !truncatedByMax, truncatedByMax, pagesWalked, lastPage, notes };
}

// ── profile enrichment ──────────────────────────────────────────────────────

const GQL_USER_FIELDS = `
  login
  name
  company
  location
  bio
  websiteUrl
  twitterUsername
  email
  isHireable
  createdAt
  followers { totalCount }
  following { totalCount }
  repositories(privacy: PUBLIC) { totalCount }
`;

interface GqlUser {
  login?: string;
  name?: string | null;
  company?: string | null;
  location?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  twitterUsername?: string | null;
  email?: string | null;
  isHireable?: boolean | null;
  createdAt?: string | null;
  followers?: { totalCount?: number };
  following?: { totalCount?: number };
  repositories?: { totalCount?: number };
}

function profileFromGql(user: GqlUser): Profile | null {
  if (!user.login) return null;
  return {
    login: user.login,
    name: user.name ?? null,
    company: normalizeCompany(user.company),
    location: user.location ?? null,
    bio: user.bio ?? null,
    blog: user.websiteUrl ?? null,
    twitter: user.twitterUsername ?? null,
    email: user.email && user.email.length > 0 ? user.email : null,
    followers: user.followers?.totalCount ?? null,
    following: user.following?.totalCount ?? null,
    publicRepos: user.repositories?.totalCount ?? null,
    createdAt: user.createdAt ?? null,
    hireable: user.isHireable ?? null,
  };
}

function profileFromRest(user: RestUser): Profile | null {
  if (!user.login) return null;
  return {
    login: user.login,
    name: user.name ?? null,
    company: normalizeCompany(user.company),
    location: user.location ?? null,
    bio: user.bio ?? null,
    blog: user.blog && user.blog.length > 0 ? user.blog : null,
    twitter: user.twitter_username ?? null,
    email: user.email ?? null,
    followers: user.followers ?? null,
    following: user.following ?? null,
    publicRepos: user.public_repos ?? null,
    createdAt: user.created_at ?? null,
    hireable: user.hireable ?? null,
  };
}

/**
 * Hydrate logins into profiles, preferring GraphQL.
 *
 * REST costs one request per user — 100 stargazers is 100 of the PAT's 5000
 * hourly requests, shared by every agent on the connection. GraphQL aliases
 * fetch 50 users in ONE request, so enrichment stops being the thing that
 * exhausts the budget. REST is kept as the fallback because some tokens (and
 * GHES setups) can't reach the GraphQL endpoint.
 */
export async function fetchProfiles(gh: GhClient, logins: string[]): Promise<{ profiles: Map<string, Profile>; via: string; missing: string[] }> {
  const unique = [...new Set(logins.filter(Boolean))];
  const profiles = new Map<string, Profile>();
  if (unique.length === 0) return { profiles, via: "none", missing: [] };

  const BATCH = 50;
  let graphqlWorked = true;

  for (let i = 0; i < unique.length && graphqlWorked; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const varDefs = batch.map((_, n) => `$l${n}: String!`).join(", ");
    const selections = batch.map((_, n) => `u${n}: user(login: $l${n}) { ...P }`).join("\n");
    const query = `query(${varDefs}) {\n${selections}\n}\nfragment P on User {${GQL_USER_FIELDS}}`;
    const variables: Record<string, unknown> = {};
    batch.forEach((login, n) => { variables[`l${n}`] = login; });

    try {
      const result = await gh.graphql<Record<string, GqlUser | null>>(query, variables);
      if (!result.data) { graphqlWorked = false; break; }
      for (const value of Object.values(result.data)) {
        if (!value) continue; // NOT_FOUND for that alias — org accounts, renamed users
        const profile = profileFromGql(value);
        if (profile) profiles.set(profile.login.toLowerCase(), profile);
      }
    } catch {
      graphqlWorked = false;
    }
  }

  const stillMissing = unique.filter((l) => !profiles.has(l.toLowerCase()));
  // REST fallback, bounded: a GraphQL outage shouldn't turn one call into
  // hundreds of requests against a shared PAT.
  const REST_FALLBACK_CAP = 150;
  const toFetch = stillMissing.slice(0, REST_FALLBACK_CAP);
  const CONCURRENCY = 5;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const slice = toFetch.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (login) => {
        const safe = pathSegment("github profile lookup: login", login);
        const user = await gh.json<RestUser>(`${GITHUB_API}/users/${safe}`, { allow404: true });
        const profile = user ? profileFromRest(user) : null;
        if (profile) profiles.set(profile.login.toLowerCase(), profile);
      }),
    );
  }

  const missing = unique.filter((l) => !profiles.has(l.toLowerCase()));
  const via = graphqlWorked ? (toFetch.length > 0 ? "graphql+rest" : "graphql") : "rest";
  return { profiles, via, missing };
}

/** The "who are these people" rollup: the part an agent can actually summarise. */
export function profileAggregates(profiles: Profile[], nowMs: number): Record<string, unknown> {
  if (profiles.length === 0) return { profiled: 0 };
  const followers = profiles.map((p) => p.followers ?? 0);
  const sorted = [...profiles].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  const youngAccounts = profiles.filter((p) => {
    if (!p.createdAt) return false;
    const ms = Date.parse(p.createdAt);
    return Number.isFinite(ms) && nowMs - ms < 90 * DAY_MS;
  }).length;

  return {
    profiled: profiles.length,
    topCompanies: topCounts(profiles.map((p) => p.company), 15),
    topLocations: topCounts(profiles.map((p) => p.location), 15),
    withCompany: profiles.filter((p) => p.company).length,
    withLocation: profiles.filter((p) => p.location).length,
    medianFollowers: median(followers),
    totalFollowerReach: followers.reduce((a, b) => a + b, 0),
    notable: sorted.slice(0, 15).map((p) => ({
      login: p.login,
      name: p.name,
      company: p.company,
      followers: p.followers,
      bio: p.bio ? p.bio.slice(0, 120) : null,
    })),
    /** A high ratio of brand-new accounts is the usual smell of bought stars. */
    accountsYoungerThan90Days: youngAccounts,
    youngAccountRatio: Math.round((youngAccounts / profiles.length) * 1000) / 10,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) * 10) / 10;
}

// ── github-list-stargazers ──────────────────────────────────────────────────

export async function handleListStargazers(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-list-stargazers";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const order = (params["order"] as string | undefined) === "oldest" ? "oldest" : "newest";
  const max = num(params["max"], 200, 1, 2_000);
  const sinceMs = isoDate(tool, "since", params["since"]);
  const untilMs = isoDate(tool, "until", params["until"]);
  const enrich = bool(params["enrich"]);
  const summaryOnly = bool(params["summaryOnly"]);
  const nowMs = Date.now();

  const totalStars = (await gh.json<{ count?: number }>(`${ref.base}/stargazers/count`, { allow404: true }))?.count ?? null;
  const fetched = await fetchStargazers(gh, tool, ref, { order, max, sinceMs, untilMs });

  let profiles: Map<string, Profile> = new Map();
  let enrichedVia = "none";
  if (enrich && fetched.rows.length > 0) {
    const result = await fetchProfiles(gh, fetched.rows.map((r) => r.login));
    profiles = result.profiles;
    enrichedVia = result.via;
  }

  const withinDays = (days: number): number =>
    fetched.rows.filter((r) => r.starredAt && nowMs - Date.parse(r.starredAt) <= days * DAY_MS).length;

  const rows = fetched.rows.map((row) => {
    const profile = profiles.get(row.login.toLowerCase());
    return {
      login: row.login,
      starredAt: row.starredAt,
      profileUrl: row.profileUrl,
      ...(profile
        ? {
            name: profile.name,
            company: profile.company,
            location: profile.location,
            followers: profile.followers,
            publicRepos: profile.publicRepos,
            bio: profile.bio ? profile.bio.slice(0, 160) : null,
          }
        : {}),
    };
  });

  const profileList = [...profiles.values()];
  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    order,
    window: { since: sinceMs ? new Date(sinceMs).toISOString() : null, until: untilMs ? new Date(untilMs).toISOString() : null },
    totalStars,
    count: rows.length,
    /** TRUE only when this is the whole matching set. Check it before saying "all N stargazers". */
    complete: fetched.complete,
    truncatedByMax: fetched.truncatedByMax,
    pagesWalked: fetched.pagesWalked,
    recent: {
      last7Days: withinDays(7),
      last30Days: withinDays(30),
      // Only meaningful when the walk actually covers that far back.
      basedOnFetchedRowsOnly: !fetched.complete,
    },
    ...(enrich ? { enrichedVia, aggregates: profileAggregates(profileList, nowMs) } : {}),
    ...(summaryOnly ? {} : { stargazers: rows }),
    ...(fetched.notes.length > 0 ? { notes: fetched.notes } : {}),
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const newest = rows[0]?.starredAt ?? null;
  const headline =
    `${ref.slug}: ${rows.length} stargazer${rows.length === 1 ? "" : "s"} returned` +
    (totalStars !== null ? ` of ${totalStars} total` : "") +
    (newest ? `, most recent ${newest.slice(0, 10)}` : "") +
    (fetched.complete ? "" : " (partial set)");

  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/stargazers", `${ref.slug} stargazers`)]);
}

// ── github-star-history ─────────────────────────────────────────────────────

interface StarHistoryWeek {
  week?: number;
  total?: number;
  days?: number[];
}

/**
 * Fetch weekly star buckets from `/repos/{o}/{r}/stargazers/history`.
 *
 * `per_page` caps at 30 there, so a year is two pages. The endpoint doesn't
 * document whether page 1 is the oldest or newest slice, so orientation is
 * detected from the data: if page 1 already contains the current week we walk
 * forward, otherwise we walk backwards from the last page.
 */
async function fetchStarHistoryWeeks(
  gh: GhClient,
  ref: { base: string },
  weeksWanted: number,
  nowMs: number,
): Promise<{ weeks: StarHistoryWeek[]; pagesWalked: number } | null> {
  const HISTORY_PAGE = 30;
  const url = (page: number) => `${ref.base}/stargazers/history?per_page=${HISTORY_PAGE}&page=${page}`;

  const first = await gh.jsonWithRes<StarHistoryWeek[]>(url(1), { allow404: true });
  if (!first || !Array.isArray(first.data)) return null;

  const lastPage = pageFromLink(first.res.headers.get("link"), "last") ?? 1;
  const collected = new Map<number, StarHistoryWeek>();
  const absorb = (page: StarHistoryWeek[]) => {
    for (const entry of page) if (typeof entry.week === "number") collected.set(entry.week, entry);
  };
  absorb(first.data);

  const maxWeek = Math.max(0, ...first.data.map((w) => w.week ?? 0));
  const page1IsRecent = maxWeek * 1000 > nowMs - 21 * DAY_MS;
  const pageBudget = Math.min(lastPage, Math.ceil(weeksWanted / HISTORY_PAGE) + 1);

  let pagesWalked = 1;
  if (page1IsRecent) {
    for (let page = 2; page <= pageBudget && collected.size < weeksWanted; page++) {
      const data = await gh.json<StarHistoryWeek[]>(url(page), { allow404: true });
      pagesWalked += 1;
      if (!data || data.length === 0) break;
      absorb(data);
    }
  } else {
    for (let page = lastPage; page >= 1 && collected.size < weeksWanted && pagesWalked <= pageBudget + 1; page--) {
      if (page === 1) break; // already have it
      const data = await gh.json<StarHistoryWeek[]>(url(page), { allow404: true });
      pagesWalked += 1;
      if (!data || data.length === 0) break;
      absorb(data);
    }
  }

  const weeks = [...collected.values()].sort((a, b) => (a.week ?? 0) - (b.week ?? 0));
  return { weeks: weeks.slice(-weeksWanted), pagesWalked };
}

/** Flatten weekly buckets into a dated daily series. days[0] is the week's first day (UTC). */
function dailySeriesFromWeeks(weeks: StarHistoryWeek[]): Array<{ date: string; adds: number }> {
  const series: Array<{ date: string; adds: number }> = [];
  for (const week of weeks) {
    if (typeof week.week !== "number") continue;
    const start = week.week * 1000;
    const days = Array.isArray(week.days) ? week.days : [];
    for (let i = 0; i < days.length; i++) {
      series.push({ date: ymd(start + i * DAY_MS), adds: days[i] ?? 0 });
    }
  }
  return series.sort((a, b) => a.date.localeCompare(b.date));
}

function sumWindow(series: Array<{ date: string; adds: number }>, fromMs: number, toMs: number): number {
  return series.reduce((acc, point) => {
    const ms = Date.parse(`${point.date}T00:00:00Z`);
    return Number.isFinite(ms) && ms >= fromMs && ms < toMs ? acc + point.adds : acc;
  }, 0);
}

export async function handleStarHistory(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-star-history";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const weeksWanted = num(params["weeks"], 52, 1, 260);
  const granularity = (params["granularity"] as string | undefined) === "day" ? "day" : "week";
  const format = (params["format"] as string | undefined) === "series" ? "series" : "summary";
  const nowMs = Date.now();

  const currentTotal = (await gh.json<{ count?: number }>(`${ref.base}/stargazers/count`, { allow404: true }))?.count ?? null;
  const history = await fetchStarHistoryWeeks(gh, ref, weeksWanted, nowMs);

  const notes: string[] = [];
  let weeks: StarHistoryWeek[] = history?.weeks ?? [];
  let derived = false;

  if (!history || weeks.length === 0) {
    // The history endpoint isn't available (older GHES, or the repo has no
    // stars yet). Reconstruct from starred_at so the tool still answers,
    // clearly flagged as derived and capped.
    derived = true;
    const cap = 1_000;
    const fetched = await fetchStargazers(gh, tool, ref, {
      order: "newest",
      max: cap,
      sinceMs: nowMs - weeksWanted * 7 * DAY_MS,
      untilMs: null,
    });
    const byWeek = new Map<number, number[]>();
    for (const row of fetched.rows) {
      if (!row.starredAt) continue;
      const ms = Date.parse(row.starredAt);
      if (!Number.isFinite(ms)) continue;
      const day = Math.floor(ms / DAY_MS) * DAY_MS;
      const weekStart = day - new Date(day).getUTCDay() * DAY_MS;
      const bucket = byWeek.get(weekStart / 1000) ?? new Array<number>(7).fill(0);
      const offset = Math.floor((day - weekStart) / DAY_MS);
      bucket[offset] = (bucket[offset] ?? 0) + 1;
      byWeek.set(weekStart / 1000, bucket);
    }
    weeks = [...byWeek.entries()]
      .map(([week, days]) => ({ week, days, total: days.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.week - b.week);
    notes.push(
      `GitHub's /stargazers/history endpoint returned nothing for this repo, so the series was DERIVED from the ${fetched.rows.length} most recent starred_at timestamps${fetched.complete ? "" : " (capped, so the oldest weeks shown may undercount)"}.`,
    );
  }

  const daily = dailySeriesFromWeeks(weeks);
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS + DAY_MS;
  const window = (days: number) => sumWindow(daily, todayStart - days * DAY_MS, todayStart);
  const prevWindow = (days: number) => sumWindow(daily, todayStart - 2 * days * DAY_MS, todayStart - days * DAY_MS);

  const last7 = window(7);
  const last30 = window(30);
  const last90 = window(90);
  const weeklySeries = weeks.map((w) => ({
    weekStart: typeof w.week === "number" ? ymd(w.week * 1000) : null,
    adds: Array.isArray(w.days) ? w.days.reduce((a, b) => a + b, 0) : (w.total ?? 0),
  }));

  // Cumulative is anchored to the CURRENT count and walked backwards, so it
  // stays correct even though the series only covers a recent window.
  let cumulative: Array<{ weekStart: string | null; total: number }> = [];
  if (currentTotal !== null) {
    let running = currentTotal;
    cumulative = [...weeklySeries]
      .reverse()
      .map((w) => {
        const point = { weekStart: w.weekStart, total: running };
        running -= w.adds;
        return point;
      })
      .reverse();
  }

  const bestDay = daily.reduce<{ date: string; adds: number } | null>((best, point) => (!best || point.adds > best.adds ? point : best), null);
  const bestWeek = weeklySeries.reduce<{ weekStart: string | null; adds: number } | null>((best, week) => (!best || week.adds > best.adds ? week : best), null);
  const activeWeeks = weeklySeries.filter((w) => w.adds > 0).length;

  const trend = last30 > prevWindow(30) ? "accelerating" : last30 < prevWindow(30) ? "slowing" : "flat";
  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    currentStars: currentTotal,
    weeksCovered: weeklySeries.length,
    derived,
    summary: {
      last7Days: last7,
      previous7Days: prevWindow(7),
      change7DayPct: pct(last7, prevWindow(7)),
      last30Days: last30,
      previous30Days: prevWindow(30),
      change30DayPct: pct(last30, prevWindow(30)),
      last90Days: last90,
      averagePerWeek: weeklySeries.length > 0 ? Math.round((weeklySeries.reduce((a, w) => a + w.adds, 0) / weeklySeries.length) * 10) / 10 : 0,
      trailing4WeekAverage: weeklySeries.length > 0 ? Math.round((weeklySeries.slice(-4).reduce((a, w) => a + w.adds, 0) / Math.min(4, weeklySeries.length)) * 10) / 10 : 0,
      bestDay,
      bestWeek,
      activeWeeks,
      trend,
    },
    ...(format === "series"
      ? granularity === "day"
        ? { dailySeries: daily, weeklySeries }
        : { weeklySeries, ...(cumulative.length > 0 ? { cumulativeByWeek: cumulative } : {}) }
      : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const headline = `${ref.slug}: ${currentTotal ?? "?"} stars, +${last7} in 7d / +${last30} in 30d (${trend})`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/stargazers", `${ref.slug} stars`)]);
}

// ── github-stargazer-profiles ───────────────────────────────────────────────

export async function handleStargazerProfiles(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-stargazer-profiles";
  const gh = new GhClient(credentials["token"] as string, tool);
  const explicitLogins = stringArray(params["logins"]);
  const nowMs = Date.now();

  let logins = explicitLogins;
  let ref: ReturnType<typeof repoRef> | null = null;
  let sourceComplete = true;

  if (logins.length === 0) {
    ref = repoRef(tool, params);
    const limit = num(params["limit"], 100, 1, 500);
    const order = (params["order"] as string | undefined) === "oldest" ? "oldest" : "newest";
    const sinceMs = isoDate(tool, "since", params["since"]);
    const fetched = await fetchStargazers(gh, tool, ref, { order, max: limit, sinceMs, untilMs: null });
    logins = fetched.rows.map((r) => r.login);
    sourceComplete = fetched.complete;
  } else if (typeof params["owner"] === "string" && typeof params["repo"] === "string") {
    ref = repoRef(tool, params);
  }

  if (logins.length === 0) {
    const empty = { source: ref?.slug ?? "logins", profiled: 0, note: "No stargazers matched — nothing to profile." };
    return { content: `No profiles to return.\n\n${JSON.stringify(empty, null, 2)}` };
  }

  const { profiles, via, missing } = await fetchProfiles(gh, logins);
  const list = [...profiles.values()];
  const includeRows = bool(params["includeRows"]);

  const manifest: Record<string, unknown> = {
    source: ref?.slug ?? "explicit logins",
    requested: logins.length,
    resolved: list.length,
    enrichedVia: via,
    sourceComplete,
    ...(missing.length > 0 ? { unresolvedLogins: missing.slice(0, 25) } : {}),
    aggregates: profileAggregates(list, nowMs),
    ...(includeRows
      ? {
          profiles: list.map((p) => ({
            login: p.login,
            name: p.name,
            company: p.company,
            location: p.location,
            followers: p.followers,
            publicRepos: p.publicRepos,
            blog: p.blog,
            twitter: p.twitter,
            createdAt: p.createdAt,
            bio: p.bio ? p.bio.slice(0, 160) : null,
          })),
        }
      : {}),
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const topCompany = (manifest["aggregates"] as { topCompanies?: Array<{ value: string; count: number }> }).topCompanies?.[0];
  const headline =
    `Profiled ${list.length} stargazer${list.length === 1 ? "" : "s"}` +
    (ref ? ` of ${ref.slug}` : "") +
    (topCompany ? ` — top company ${topCompany.value} (${topCompany.count})` : "");

  const citations = ref ? [repoCitation(ref.owner, ref.repo, "/stargazers", `${ref.slug} stargazers`)] : [];
  return cited(headline, manifest, citations);
}

// ── github-repo-traffic ─────────────────────────────────────────────────────

interface TrafficSeries {
  count?: number;
  uniques?: number;
  views?: Array<{ timestamp?: string; count?: number; uniques?: number }>;
  clones?: Array<{ timestamp?: string; count?: number; uniques?: number }>;
}

/**
 * The traffic API is the only place GitHub exposes *reach* rather than
 * reaction — who looked, who cloned, where they came from. It is also the only
 * one that needs PUSH access, and it only keeps 14 days, so the 403 message
 * has to name the permission and the payload has to name the window.
 */
export async function handleRepoTraffic(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-repo-traffic";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const requested = stringArray(params["metrics"]);
  const metrics = requested.length > 0 ? requested : ["views", "clones", "referrers", "paths"];
  const per = (params["per"] as string | undefined) === "week" ? "week" : "day";
  const forbiddenHint =
    "The traffic API requires PUSH access to the repository — a read-only PAT cannot see it. Use a token with repo write access (fine-grained PAT: Administration → read).";

  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    window: "GitHub only retains the last 14 days of traffic data",
    granularity: per,
  };

  if (metrics.includes("views")) {
    const views = await gh.json<TrafficSeries>(`${ref.base}/traffic/views?per=${per}`, { forbiddenHint });
    manifest["views"] = {
      total: views?.count ?? 0,
      uniqueVisitors: views?.uniques ?? 0,
      series: (views?.views ?? []).map((v) => ({ timestamp: v.timestamp ?? null, count: v.count ?? 0, uniques: v.uniques ?? 0 })),
    };
  }
  if (metrics.includes("clones")) {
    const clones = await gh.json<TrafficSeries>(`${ref.base}/traffic/clones?per=${per}`, { forbiddenHint });
    manifest["clones"] = {
      total: clones?.count ?? 0,
      uniqueCloners: clones?.uniques ?? 0,
      series: (clones?.clones ?? []).map((c) => ({ timestamp: c.timestamp ?? null, count: c.count ?? 0, uniques: c.uniques ?? 0 })),
    };
  }
  if (metrics.includes("referrers")) {
    const referrers = await gh.json<Array<{ referrer?: string; count?: number; uniques?: number }>>(`${ref.base}/traffic/popular/referrers`, { forbiddenHint });
    manifest["topReferrers"] = (referrers ?? []).map((r) => ({ referrer: r.referrer ?? "", views: r.count ?? 0, uniques: r.uniques ?? 0 }));
  }
  if (metrics.includes("paths")) {
    const paths = await gh.json<Array<{ path?: string; title?: string; count?: number; uniques?: number }>>(`${ref.base}/traffic/popular/paths`, { forbiddenHint });
    manifest["topPaths"] = (paths ?? []).map((p) => ({ path: p.path ?? "", title: p.title ?? "", views: p.count ?? 0, uniques: p.uniques ?? 0 }));
  }

  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const views = manifest["views"] as { total?: number; uniqueVisitors?: number } | undefined;
  const clones = manifest["clones"] as { total?: number; uniqueCloners?: number } | undefined;
  const headline =
    `${ref.slug} last 14 days: ` +
    [
      views ? `${views.total} views / ${views.uniqueVisitors} unique` : null,
      clones ? `${clones.total} clones / ${clones.uniqueCloners} unique` : null,
    ]
      .filter(Boolean)
      .join(", ");

  return cited(headline || `${ref.slug} traffic`, manifest, [repoCitation(ref.owner, ref.repo, "/graphs/traffic", `${ref.slug} traffic`)]);
}

// ── github-repo-snapshot ────────────────────────────────────────────────────

interface RestRepo {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  homepage?: string | null;
  stargazers_count?: number;
  watchers_count?: number;
  subscribers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  network_count?: number;
  size?: number;
  language?: string | null;
  topics?: string[];
  license?: { spdx_id?: string; name?: string } | null;
  default_branch?: string;
  visibility?: string;
  archived?: boolean;
  fork?: boolean;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
}

/** `/search/issues` total_count for a query, or null when search is unavailable. */
async function searchCount(gh: GhClient, query: string): Promise<number | null> {
  const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=1&advanced_search=true`;
  const result = await gh.json<{ total_count?: number }>(url, { allow404: true });
  return typeof result?.total_count === "number" ? result.total_count : null;
}

export async function handleRepoSnapshot(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-repo-snapshot";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const repo = await gh.json<RestRepo>(ref.base);
  if (!repo) throw new Error(`${tool}: ${ref.slug} returned no repository data`);

  const manifest: Record<string, unknown> = {
    repo: repo.full_name ?? ref.slug,
    description: repo.description ?? null,
    homepage: repo.homepage || null,
    visibility: repo.visibility ?? null,
    archived: repo.archived ?? false,
    isFork: repo.fork ?? false,
    defaultBranch: repo.default_branch ?? null,
    license: repo.license?.spdx_id ?? null,
    primaryLanguage: repo.language ?? null,
    topics: repo.topics ?? [],
    sizeKb: repo.size ?? null,
    counts: {
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      /** `subscribers_count` is the real watcher count; `watchers_count` is a legacy alias for stars. */
      watchers: repo.subscribers_count ?? 0,
      /** GitHub's open_issues_count INCLUDES pull requests — use splitIssues for the real split. */
      openIssuesAndPRs: repo.open_issues_count ?? 0,
    },
    dates: {
      createdAt: repo.created_at ?? null,
      lastPushedAt: repo.pushed_at ?? null,
      updatedAt: repo.updated_at ?? null,
      daysSinceLastPush: repo.pushed_at ? Math.floor((Date.now() - Date.parse(repo.pushed_at)) / DAY_MS) : null,
    },
  };

  if (bool(params["splitIssues"])) {
    const [openIssues, openPRs] = await Promise.all([
      searchCount(gh, `repo:${ref.slug} is:issue is:open`),
      searchCount(gh, `repo:${ref.slug} is:pr is:open`),
    ]);
    manifest["openSplit"] = { openIssues, openPullRequests: openPRs };
  }

  if (bool(params["includeLanguages"])) {
    const languages = (await gh.json<Record<string, number>>(`${ref.base}/languages`, { allow404: true })) ?? {};
    const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    manifest["languages"] = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, bytes]) => ({ name, bytes, pct: Math.round((bytes / total) * 1000) / 10 }));
  }

  if (bool(params["includeCommunity"])) {
    const community = await gh.json<{ health_percentage?: number; files?: Record<string, unknown> }>(`${ref.base}/community/profile`, { allow404: true, forbiddenHint: "The community profile endpoint needs read access to the repository." });
    if (community) {
      manifest["community"] = {
        healthPercentage: community.health_percentage ?? null,
        present: Object.entries(community.files ?? {})
          .filter(([, value]) => value !== null)
          .map(([key]) => key),
        missing: Object.entries(community.files ?? {})
          .filter(([, value]) => value === null)
          .map(([key]) => key),
      };
    }
  }

  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const counts = manifest["counts"] as { stars: number; forks: number; watchers: number };
  const headline = `${ref.slug}: ${counts.stars} stars, ${counts.forks} forks, ${counts.watchers} watchers`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "", ref.slug)]);
}

// ── github-list-forks ───────────────────────────────────────────────────────

interface RestFork {
  full_name?: string;
  html_url?: string;
  owner?: RestUser;
  created_at?: string;
  pushed_at?: string;
  updated_at?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  archived?: boolean;
}

/**
 * Forks are the strongest cheap adoption signal after stars: starring is a
 * bookmark, forking is intent to use. `activeOnly` separates the two kinds —
 * a fork whose `pushed_at` has moved past its `created_at` had real work done
 * in it, everything else is a drive-by copy.
 */
export async function handleListForks(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-list-forks";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const sortParam = (params["sort"] as string | undefined) ?? "newest";
  const sort = sortParam === "oldest" ? "oldest" : sortParam === "stargazers" ? "stargazers" : "newest";
  const max = num(params["max"], 50, 1, 500);
  const sinceMs = isoDate(tool, "since", params["since"]);
  const activeOnly = bool(params["activeOnly"]);
  const enrich = bool(params["enrich"]);

  const collected: RestFork[] = [];
  let page = 1;
  let exhausted = false;
  while (collected.length < max && page <= MAX_PAGES) {
    const data = (await gh.json<RestFork[]>(`${ref.base}/forks?sort=${sort}&per_page=${PAGE_SIZE}&page=${page}`)) ?? [];
    if (data.length === 0) { exhausted = true; break; }
    for (const fork of data) {
      if (sinceMs !== null && fork.created_at && Date.parse(fork.created_at) < sinceMs) {
        // `sort=newest` is descending by creation, so everything after this is older too.
        if (sort === "newest") { exhausted = true; break; }
        continue;
      }
      const isActive = Boolean(fork.pushed_at && fork.created_at && Date.parse(fork.pushed_at) > Date.parse(fork.created_at) + 60_000);
      if (activeOnly && !isActive) continue;
      collected.push(fork);
      if (collected.length >= max) break;
    }
    if (exhausted) break;
    if (data.length < PAGE_SIZE) { exhausted = true; break; }
    page += 1;
  }

  let profiles: Map<string, Profile> = new Map();
  if (enrich && collected.length > 0) {
    const result = await fetchProfiles(gh, collected.map((f) => f.owner?.login ?? "").filter(Boolean));
    profiles = result.profiles;
  }

  const rows = collected.map((fork) => {
    const login = fork.owner?.login ?? "";
    const isActive = Boolean(fork.pushed_at && fork.created_at && Date.parse(fork.pushed_at) > Date.parse(fork.created_at) + 60_000);
    const profile = profiles.get(login.toLowerCase());
    return {
      fullName: fork.full_name ?? "",
      owner: login,
      url: fork.html_url ?? "",
      createdAt: fork.created_at ?? null,
      lastPushedAt: fork.pushed_at ?? null,
      stars: fork.stargazers_count ?? 0,
      /** Work happened in this fork after it was created — not a drive-by copy. */
      active: isActive,
      archived: fork.archived ?? false,
      ...(profile ? { ownerName: profile.name, ownerCompany: profile.company, ownerFollowers: profile.followers } : {}),
    };
  });

  const activeCount = rows.filter((r) => r.active).length;
  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    sort,
    count: rows.length,
    complete: exhausted && collected.length < max,
    truncatedByMax: collected.length >= max,
    activeForks: activeCount,
    activeRatio: rows.length > 0 ? Math.round((activeCount / rows.length) * 1000) / 10 : 0,
    ...(enrich ? { aggregates: profileAggregates([...profiles.values()], Date.now()) } : {}),
    forks: rows,
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const headline = `${ref.slug}: ${rows.length} fork${rows.length === 1 ? "" : "s"} returned, ${activeCount} with commits after the fork`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/network/members", `${ref.slug} forks`)]);
}

// ── github-release-downloads ────────────────────────────────────────────────

interface RestRelease {
  tag_name?: string;
  name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  created_at?: string;
  html_url?: string;
  assets?: Array<{ name?: string; download_count?: number; size?: number; updated_at?: string }>;
}

/**
 * Release asset download counts — for anything that ships a binary, this is
 * the closest thing GitHub gives you to a real usage number. (Note it only
 * covers RELEASE ASSETS: `git clone`s show up in github-repo-traffic, and
 * package-registry installs aren't visible to GitHub at all.)
 */
export async function handleReleaseDownloads(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-release-downloads";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const tag = (params["tag"] as string | undefined)?.trim();
  const max = num(params["max"], 20, 1, 200);
  const includeAssets = bool(params["includeAssets"], true);

  let releases: RestRelease[] = [];
  if (tag) {
    const safeTag = pathSegment(`${tool}: tag`, tag);
    const single = await gh.json<RestRelease>(`${ref.base}/releases/tags/${safeTag}`, { allow404: true });
    if (!single) throw new Error(`${tool}: no release tagged '${tag}' in ${ref.slug}`);
    releases = [single];
  } else {
    let page = 1;
    while (releases.length < max && page <= 10) {
      const data = (await gh.json<RestRelease[]>(`${ref.base}/releases?per_page=${PAGE_SIZE}&page=${page}`)) ?? [];
      releases.push(...data);
      if (data.length < PAGE_SIZE) break;
      page += 1;
    }
    releases = releases.slice(0, max);
  }

  const rows = releases.map((release) => {
    const assets = release.assets ?? [];
    const downloads = assets.reduce((acc, asset) => acc + (asset.download_count ?? 0), 0);
    return {
      tag: release.tag_name ?? "",
      name: release.name ?? null,
      publishedAt: release.published_at ?? release.created_at ?? null,
      prerelease: release.prerelease ?? false,
      draft: release.draft ?? false,
      assetCount: assets.length,
      downloads,
      ...(includeAssets
        ? {
            assets: assets
              .map((asset) => ({ name: asset.name ?? "", downloads: asset.download_count ?? 0, sizeMb: asset.size ? Math.round((asset.size / 1_048_576) * 10) / 10 : null }))
              .sort((a, b) => b.downloads - a.downloads),
          }
        : {}),
    };
  });

  const totalDownloads = rows.reduce((acc, row) => acc + row.downloads, 0);
  const published = rows.filter((r) => !r.draft && !r.prerelease);
  const latest = published[0] ?? rows[0] ?? null;

  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    releasesReturned: rows.length,
    totalDownloads,
    latestRelease: latest ? { tag: latest.tag, publishedAt: latest.publishedAt, downloads: latest.downloads } : null,
    averageDownloadsPerRelease: rows.length > 0 ? Math.round(totalDownloads / rows.length) : 0,
    note: "Counts cover RELEASE ASSETS only — source-tarball and git-clone traffic is not included here (see github-repo-traffic).",
    releases: rows,
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const headline = `${ref.slug}: ${totalDownloads} release-asset downloads across ${rows.length} release${rows.length === 1 ? "" : "s"}`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/releases", `${ref.slug} releases`)]);
}

// ── github-repo-activity ────────────────────────────────────────────────────

interface ContributorStat {
  author?: { login?: string } | null;
  total?: number;
  weeks?: Array<{ w?: number; a?: number; d?: number; c?: number }>;
}

/**
 * Maintainer-vs-community activity from GitHub's `/stats/*` endpoints.
 *
 * `participation` splits the last 52 weeks into owner commits and all commits
 * — the ratio is the single clearest "is this a project or a solo repo"
 * number. All three endpoints answer 202 while GitHub computes them, which is
 * why GhClient.statsWithRetry exists; a naive caller gets an empty array on a
 * cold repo and reports "no activity".
 */
export async function handleRepoActivity(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-repo-activity";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const requested = stringArray(params["metrics"]);
  const metrics = requested.length > 0 ? requested : ["participation", "commit_activity"];
  const weeks = num(params["weeks"], 12, 1, 52);
  const topContributors = num(params["topContributors"], 15, 1, 100);
  const notes: string[] = [];

  const manifest: Record<string, unknown> = { repo: ref.slug, weeksRequested: weeks };

  if (metrics.includes("participation")) {
    const participation = await gh.statsWithRetry<{ all?: number[]; owner?: number[] }>(`${ref.base}/stats/participation`);
    if (participation) {
      const all = (participation.all ?? []).slice(-weeks);
      const owner = (participation.owner ?? []).slice(-weeks);
      const allTotal = all.reduce((a, b) => a + b, 0);
      const ownerTotal = owner.reduce((a, b) => a + b, 0);
      manifest["participation"] = {
        weeks: all.length,
        totalCommits: allTotal,
        ownerCommits: ownerTotal,
        communityCommits: allTotal - ownerTotal,
        communitySharePct: allTotal > 0 ? Math.round(((allTotal - ownerTotal) / allTotal) * 1000) / 10 : 0,
        weeklyCommits: all,
        // GitHub's `owner` series counts commits by the owner ACCOUNT. For an
        // org-owned repo that account never commits, so the series is all
        // zeros and the split reads "100% community" — true but meaningless.
        // Verified against juspay/xyne-spaces: owner sums to 0 over 52 weeks.
        ...(ownerTotal === 0 && allTotal > 0
          ? {
              ownerSplitMeaningful: false,
              note: "GitHub reported zero owner commits, which is what it always reports for an ORG-owned repo (the owner is the org account, not a person). Do not read this as '100% community' — use metrics:[\"contributors\"] for the real author breakdown.",
            }
          : { ownerSplitMeaningful: true }),
      };
    } else {
      notes.push("GitHub is still computing /stats/participation (202 after retries) — ask again in a minute.");
    }
  }

  if (metrics.includes("commit_activity")) {
    const activity = await gh.statsWithRetry<Array<{ week?: number; total?: number; days?: number[] }>>(`${ref.base}/stats/commit_activity`);
    if (Array.isArray(activity)) {
      const recent = activity.slice(-weeks);
      manifest["commitActivity"] = {
        weeks: recent.map((w) => ({ weekStart: typeof w.week === "number" ? ymd(w.week * 1000) : null, commits: w.total ?? 0 })),
        totalCommits: recent.reduce((acc, w) => acc + (w.total ?? 0), 0),
      };
    } else {
      notes.push("GitHub is still computing /stats/commit_activity (202 after retries) — ask again in a minute.");
    }
  }

  if (metrics.includes("contributors")) {
    const contributors = await gh.statsWithRetry<ContributorStat[]>(`${ref.base}/stats/contributors`);
    if (Array.isArray(contributors)) {
      const nowMs = Date.now();
      const cutoff = nowMs - 90 * DAY_MS;
      const rows = contributors
        .map((entry) => {
          const weeksWithCommits = (entry.weeks ?? []).filter((w) => (w.c ?? 0) > 0);
          const firstWeek = weeksWithCommits[0]?.w;
          const lastWeek = weeksWithCommits[weeksWithCommits.length - 1]?.w;
          return {
            login: entry.author?.login ?? "(unknown)",
            commits: entry.total ?? 0,
            firstCommitWeek: typeof firstWeek === "number" ? ymd(firstWeek * 1000) : null,
            lastCommitWeek: typeof lastWeek === "number" ? ymd(lastWeek * 1000) : null,
            isNewInLast90Days: typeof firstWeek === "number" && firstWeek * 1000 >= cutoff,
          };
        })
        .sort((a, b) => b.commits - a.commits);
      manifest["contributors"] = {
        total: rows.length,
        newInLast90Days: rows.filter((r) => r.isNewInLast90Days).map((r) => r.login),
        // Weekly per-contributor arrays are enormous; the ranked totals are
        // what an agent can actually reason about.
        top: rows.slice(0, topContributors),
      };
    } else {
      notes.push("GitHub is still computing /stats/contributors (202 after retries) — ask again in a minute.");
    }
  }

  if (notes.length > 0) manifest["notes"] = notes;
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const participation = manifest["participation"] as
    | { totalCommits?: number; communitySharePct?: number; ownerSplitMeaningful?: boolean }
    | undefined;
  const headline = participation
    ? `${ref.slug}: ${participation.totalCommits} commits in the window` +
      (participation.ownerSplitMeaningful
        ? `, ${participation.communitySharePct}% from outside the owner`
        : " (owner/community split unavailable — org-owned repo)")
    : `${ref.slug} activity`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/graphs/contributors", `${ref.slug} contributors`)]);
}

// ── github-community-pulse ──────────────────────────────────────────────────

interface SearchIssueItem {
  number?: number;
  title?: string;
  created_at?: string;
  user?: { login?: string };
  pull_request?: unknown;
  html_url?: string;
}

/**
 * Engagement rather than reaction: who OUTSIDE the maintainers is opening
 * issues and PRs, who just landed their first contribution, and how fast the
 * project answers.
 *
 * Everything here rides the search API, which has its own 30-requests-per-
 * minute bucket, so the number of lookups is capped and every cap that bit is
 * reported in the payload.
 */
export async function handleCommunityPulse(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-community-pulse";
  const gh = new GhClient(credentials["token"] as string, tool);
  const ref = repoRef(tool, params);

  const days = num(params["days"], 30, 1, 365);
  const excludeLogins = stringArray(params["excludeLogins"]).filter((l) => /^[A-Za-z0-9-]{1,39}$/.test(l));
  const wantLatency = bool(params["responseLatency"], true);
  const wantNewContributors = bool(params["includeNewContributors"], true);
  const maxIssuesSampled = num(params["maxIssuesSampled"], 20, 1, 50);

  const nowMs = Date.now();
  const sinceMs = nowMs - days * DAY_MS;
  const since = ymd(sinceMs);
  const exclusion = excludeLogins.map((l) => ` -author:${l}`).join("");
  const notes: string[] = [];
  /** Authors checked for first-contribution status — one search each. */
  const AUTHOR_CHECK_CAP = 15;

  const [issuesOpened, prsOpened, prsMerged, issuesClosed] = await Promise.all([
    searchCount(gh, `repo:${ref.slug} is:issue created:>=${since}${exclusion}`),
    searchCount(gh, `repo:${ref.slug} is:pr created:>=${since}${exclusion}`),
    searchCount(gh, `repo:${ref.slug} is:pr is:merged merged:>=${since}${exclusion}`),
    searchCount(gh, `repo:${ref.slug} is:issue closed:>=${since}`),
  ]);

  const manifest: Record<string, unknown> = {
    repo: ref.slug,
    windowDays: days,
    since,
    excludedAuthors: excludeLogins,
    opened: { issues: issuesOpened, pullRequests: prsOpened },
    merged: { pullRequests: prsMerged },
    closed: { issues: issuesClosed },
  };

  if (wantNewContributors) {
    const mergedList = await gh.json<{ items?: SearchIssueItem[] }>(
      `${GITHUB_API}/search/issues?q=${encodeURIComponent(`repo:${ref.slug} is:pr is:merged merged:>=${since}${exclusion}`)}&per_page=100&advanced_search=true`,
      { allow404: true },
    );
    const authors = [...new Set((mergedList?.items ?? []).map((item) => item.user?.login).filter((l): l is string => Boolean(l)))];
    const checked = authors.slice(0, AUTHOR_CHECK_CAP);
    if (authors.length > checked.length) {
      notes.push(`${authors.length} distinct authors merged PRs in the window; only the first ${AUTHOR_CHECK_CAP} were checked for first-time status (the search API allows 30 requests/minute).`);
    }
    const firstTimers: string[] = [];
    for (const author of checked) {
      const priorCount = await searchCount(gh, `repo:${ref.slug} is:pr is:merged author:${author} merged:<${since}`);
      if (priorCount === 0) firstTimers.push(author);
    }
    manifest["contributors"] = {
      distinctMergedAuthors: authors.length,
      authorsCheckedForFirstContribution: checked.length,
      firstTimeContributors: firstTimers,
      returningContributors: checked.filter((a) => !firstTimers.includes(a)),
    };
  }

  if (wantLatency) {
    const issues = (await gh.json<SearchIssueItem[]>(
      `${ref.base}/issues?state=all&sort=created&direction=desc&per_page=${maxIssuesSampled}`,
      { allow404: true },
    )) ?? [];
    // The issues endpoint returns PRs too; only real issues belong in a
    // "how fast do we answer people" number.
    const realIssues = issues
      .filter((item) => !item.pull_request && item.created_at && Date.parse(item.created_at) >= sinceMs)
      .slice(0, maxIssuesSampled);

    const latencies: number[] = [];
    let unanswered = 0;
    for (const issue of realIssues) {
      if (typeof issue.number !== "number" || !issue.created_at) continue;
      const comments = (await gh.json<Array<{ created_at?: string; user?: { login?: string } }>>(
        `${ref.base}/issues/${issue.number}/comments?per_page=10`,
        { allow404: true },
      )) ?? [];
      const author = issue.user?.login;
      const firstOther = comments.find((c) => c.user?.login && c.user.login !== author);
      if (!firstOther?.created_at) { unanswered += 1; continue; }
      const hours = (Date.parse(firstOther.created_at) - Date.parse(issue.created_at)) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) latencies.push(Math.round(hours * 10) / 10);
    }
    manifest["responsiveness"] = {
      sampledIssues: realIssues.length,
      answered: latencies.length,
      unanswered,
      medianFirstResponseHours: latencies.length > 0 ? median(latencies) : null,
      fastestHours: latencies.length > 0 ? Math.min(...latencies) : null,
      slowestHours: latencies.length > 0 ? Math.max(...latencies) : null,
      note: `Sampled the ${realIssues.length} most recent issues opened in the window (cap ${maxIssuesSampled}) — not the full set.`,
    };
  }

  if (notes.length > 0) manifest["notes"] = notes;
  manifest["searchRequestsUsed"] = gh.searchRequestCount;
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  const headline = `${ref.slug} last ${days}d: ${issuesOpened ?? "?"} issues and ${prsOpened ?? "?"} PRs opened, ${prsMerged ?? "?"} PRs merged`;
  return cited(headline, manifest, [repoCitation(ref.owner, ref.repo, "/issues", `${ref.slug} issues`)]);
}

// ── github-compare-repos ────────────────────────────────────────────────────

/**
 * The same snapshot across several repos, so "are we growing" can be answered
 * relative to the alternatives instead of in a vacuum.
 */
export async function handleCompareRepos(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const tool = "github-compare-repos";
  const gh = new GhClient(credentials["token"] as string, tool);

  const slugs = stringArray(params["repos"]);
  if (slugs.length === 0) throw new Error(`${tool}: repos is required — a list of "owner/repo" strings`);
  if (slugs.length > 10) throw new Error(`${tool}: at most 10 repos per call (got ${slugs.length})`);

  const includeStarVelocity = bool(params["includeStarVelocity"], true);
  const includeReleases = bool(params["includeReleases"]);
  const includeActivity = bool(params["includeActivity"]);
  const velocityDays = num(params["velocityDays"], 30, 1, 180);
  const nowMs = Date.now();

  const rows = await Promise.all(
    slugs.map(async (slug) => {
      const ref = repoRefFromSlug(tool, slug);
      try {
        const repo = await gh.json<RestRepo>(ref.base, { allow404: true });
        if (!repo) return { repo: ref.slug, error: "not found, or the connected PAT cannot see it" };

        const row: Record<string, unknown> = {
          repo: repo.full_name ?? ref.slug,
          stars: repo.stargazers_count ?? 0,
          forks: repo.forks_count ?? 0,
          watchers: repo.subscribers_count ?? 0,
          openIssuesAndPRs: repo.open_issues_count ?? 0,
          primaryLanguage: repo.language ?? null,
          license: repo.license?.spdx_id ?? null,
          createdAt: repo.created_at ?? null,
          lastPushedAt: repo.pushed_at ?? null,
          daysSinceLastPush: repo.pushed_at ? Math.floor((nowMs - Date.parse(repo.pushed_at)) / DAY_MS) : null,
          ageYears: repo.created_at ? Math.round(((nowMs - Date.parse(repo.created_at)) / (365 * DAY_MS)) * 10) / 10 : null,
        };

        if (includeStarVelocity) {
          const weeksWanted = Math.ceil(velocityDays / 7) + 1;
          const history = await fetchStarHistoryWeeks(gh, ref, weeksWanted, nowMs);
          if (history && history.weeks.length > 0) {
            const daily = dailySeriesFromWeeks(history.weeks);
            const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS + DAY_MS;
            const recent = sumWindow(daily, todayStart - velocityDays * DAY_MS, todayStart);
            const previous = sumWindow(daily, todayStart - 2 * velocityDays * DAY_MS, todayStart - velocityDays * DAY_MS);
            row[`starsLast${velocityDays}Days`] = recent;
            row["starVelocityChangePct"] = pct(recent, previous);
            const stars = repo.stargazers_count ?? 0;
            row["relativeGrowthPct"] = stars > 0 ? Math.round((recent / stars) * 1000) / 10 : null;
          } else {
            row[`starsLast${velocityDays}Days`] = null;
          }
        }

        if (includeReleases) {
          const releases = (await gh.json<RestRelease[]>(`${ref.base}/releases?per_page=${PAGE_SIZE}`, { allow404: true })) ?? [];
          row["releaseCount"] = releases.length;
          row["releaseDownloads"] = releases.reduce(
            (acc, release) => acc + (release.assets ?? []).reduce((a, asset) => a + (asset.download_count ?? 0), 0),
            0,
          );
          row["latestReleaseAt"] = releases[0]?.published_at ?? null;
        }

        if (includeActivity) {
          const participation = await gh.statsWithRetry<{ all?: number[]; owner?: number[] }>(`${ref.base}/stats/participation`, 2);
          const all = participation?.all ?? [];
          row["commitsLast12Weeks"] = all.slice(-12).reduce((a, b) => a + b, 0);
        }

        return row;
      } catch (error) {
        return { repo: ref.slug, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  const ranked = [...rows].sort((a, b) => Number(b["stars"] ?? -1) - Number(a["stars"] ?? -1));
  const failed = ranked.filter((row) => row["error"]);
  const manifest: Record<string, unknown> = {
    comparedAt: new Date(nowMs).toISOString(),
    repos: slugs.length,
    succeeded: ranked.length - failed.length,
    failed: failed.length,
    velocityWindowDays: includeStarVelocity ? velocityDays : null,
    ranking: ranked,
  };
  const rateNote = gh.rateLimitNote();
  if (rateNote) manifest["rateLimit"] = rateNote;

  // A per-repo failure is isolated on purpose, but "compared N repos" must not
  // read as success when none of them could actually be read.
  const leader = ranked[0];
  const suffix = failed.length > 0 ? ` (${failed.length} could not be read)` : "";
  const headline = leader && !leader["error"]
    ? `Compared ${slugs.length} repo${slugs.length === 1 ? "" : "s"} — ${String(leader["repo"])} leads with ${String(leader["stars"])} stars${suffix}`
    : `Compared ${slugs.length} repo${slugs.length === 1 ? "" : "s"}: none could be read${suffix}`;

  const citations: Citation[] = ranked.slice(0, 1).flatMap((row) => {
    const slug = String(row["repo"] ?? "");
    const parts = slug.split("/");
    return parts.length === 2 && parts[0] && parts[1] ? [repoCitation(parts[0], parts[1], "", slug)] : [];
  });
  return cited(headline, manifest, citations);
}

// ── tool definitions ────────────────────────────────────────────────────────

const OWNER_PROP = { type: "string", description: "Repository owner / org (e.g. juspay)" } as const;
const REPO_PROP = { type: "string", description: "Repository name (e.g. xyne-spaces)" } as const;

export const GITHUB_INSIGHTS_TOOLS: McpToolInfo[] = [
  {
    name: "github-list-stargazers",
    readOnly: true,
    description:
      "List the people who starred a repository, WITH the date each star was added, newest first by default. " +
      "Use this for 'who starred us', 'who starred us this week', or to pull an audience list out of a repo.\n\n" +
      "GitHub returns stargazers oldest-first and has no sort parameter, so recent stars live on the LAST page — this tool walks backwards for you. " +
      "Set `enrich: true` to attach each stargazer's name, company, location and follower count (batched via GraphQL, so 100 people cost 2 requests, not 100) " +
      "plus an aggregate breakdown of top companies and locations. Use `since`/`until` to bound the window and `summaryOnly` when you only want the counts.\n\n" +
      "Returns a manifest with `complete` — TRUE only when the whole matching set was enumerated, not a `max`-limited prefix. Check it before saying 'all N stargazers'. " +
      "For totals and growth rates over a long period use github-star-history instead; this tool is for the actual people.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        order: { type: "string", enum: ["newest", "oldest"], description: "Sort by star date. Default newest (walks back from the last page)." },
        since: { type: "string", description: "Only stars added on/after this ISO date (YYYY-MM-DD)." },
        until: { type: "string", description: "Only stars added on/before this ISO date (YYYY-MM-DD)." },
        max: { type: "number", description: "Maximum stargazers to return (default 200, cap 2000). `complete` reports whether the full set fit." },
        enrich: { type: "boolean", description: "Attach profile details (name, company, location, followers) and aggregate them. Default false." },
        summaryOnly: { type: "boolean", description: "Return counts and aggregates without the per-person rows. Default false." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-star-history",
    readOnly: true,
    description:
      "Star growth over time for a repository: weekly and daily add counts, 7/30/90-day totals with period-over-period change, best day, best week, and a trend verdict (accelerating / slowing / flat). " +
      "This is the tool for 'how fast are we growing', 'did the launch move the needle', or any star chart — NOT github-list-stargazers, which enumerates people and is capped by pagination depth.\n\n" +
      "Backed by GitHub's /stargazers/history endpoint plus the exact current count. If that endpoint is unavailable for the repo, the series is reconstructed from recent starred_at timestamps and the response sets `derived: true` — treat those older weeks as a floor, not a fact. " +
      "`format: \"series\"` adds the raw weekly (or daily) arrays and a cumulative star curve; the default summary is usually enough to answer in prose.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        weeks: { type: "number", description: "How many weeks of history to cover (default 52, max 260)." },
        granularity: { type: "string", enum: ["week", "day"], description: "Series granularity when format=series. Default week." },
        format: { type: "string", enum: ["summary", "series"], description: "summary = derived metrics only (default). series = include the raw arrays." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-stargazer-profiles",
    readOnly: true,
    description:
      "Profile the humans behind a repo's stars: who they work for, where they are, how big their own following is. " +
      "Answers 'what kind of people star us', 'are any of our stargazers from notable companies', and 'do these stars look organic'.\n\n" +
      "Give it owner+repo to profile that repo's stargazers (newest first), or pass an explicit `logins` list to profile specific accounts. " +
      "Returns aggregates — top companies, top locations, median followers, total follower reach, the 15 highest-follower accounts, and the share of accounts younger than 90 days " +
      "(a high young-account ratio is the usual signature of purchased stars). Set `includeRows: true` for the per-person table; by default only the rollup comes back so the payload stays small.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        logins: { type: "array", items: { type: "string" }, description: "Explicit GitHub usernames to profile. When set, owner/repo are optional." },
        limit: { type: "number", description: "How many stargazers to profile when reading from a repo (default 100, max 500)." },
        since: { type: "string", description: "Only profile people who starred on/after this ISO date (YYYY-MM-DD)." },
        order: { type: "string", enum: ["newest", "oldest"], description: "Which end of the stargazer list to profile. Default newest." },
        includeRows: { type: "boolean", description: "Include the per-person rows alongside the aggregates. Default false." },
      },
      required: [],
    },
  },
  {
    name: "github-repo-traffic",
    readOnly: true,
    description:
      "Repository traffic for the last 14 days: page views, unique visitors, git clones, unique cloners, the top 10 referring sites and the top 10 most-viewed paths. " +
      "This is reach rather than reaction — it shows people who looked or cloned without starring, and `topReferrers` is how you find out which blog post or HN thread is actually driving discovery.\n\n" +
      "IMPORTANT: GitHub only exposes traffic to tokens with PUSH access to the repository, and only keeps 14 days of it. A read-only PAT gets a 403 with that explanation. " +
      "If you need history beyond a fortnight, this must be captured periodically — the API cannot backfill.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        metrics: {
          type: "array",
          items: { type: "string", enum: ["views", "clones", "referrers", "paths"] },
          description: "Which traffic metrics to fetch. Default: all four.",
        },
        per: { type: "string", enum: ["day", "week"], description: "Bucket size for the views/clones series. Default day." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-repo-snapshot",
    readOnly: true,
    description:
      "One-call health snapshot of a repository: stars, forks, real watcher count, open issues, topics, license, primary language, default branch, creation date and days since the last push. " +
      "Use it as the baseline for any growth report or as a cheap 'how is repo X doing right now'.\n\n" +
      "Note GitHub's open_issues_count INCLUDES pull requests; pass `splitIssues: true` for the true open-issue vs open-PR split. " +
      "`includeLanguages` adds the language byte breakdown, `includeCommunity` adds GitHub's community health score and which of README / LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / issue templates are missing — the concrete checklist for making a repo easier to adopt.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        splitIssues: { type: "boolean", description: "Resolve the true open issues vs open PRs split via search. Default false." },
        includeLanguages: { type: "boolean", description: "Include the language byte breakdown. Default false." },
        includeCommunity: { type: "boolean", description: "Include the community health score and missing community files. Default false." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-list-forks",
    readOnly: true,
    description:
      "List forks of a repository, newest first, flagging which ones are ACTIVE (commits landed after the fork was created) versus drive-by copies. " +
      "Forking is a stronger adoption signal than starring — a star is a bookmark, a fork is intent to use — and the active ratio tells you which of the two you are actually getting.\n\n" +
      "`since` bounds the window, `activeOnly` filters to forks with real work in them, and `enrich` attaches each fork owner's name, company and follower count so you can see which organisations are building on the project.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        sort: { type: "string", enum: ["newest", "oldest", "stargazers"], description: "Fork ordering. Default newest." },
        max: { type: "number", description: "Maximum forks to return (default 50, cap 500)." },
        since: { type: "string", description: "Only forks created on/after this ISO date (YYYY-MM-DD)." },
        activeOnly: { type: "boolean", description: "Only forks with commits after creation. Default false." },
        enrich: { type: "boolean", description: "Attach fork-owner profile details and aggregate them. Default false." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-release-downloads",
    readOnly: true,
    description:
      "Release asset download counts per release and per asset, plus the all-release total and the average per release. " +
      "For any project that ships binaries this is the closest thing GitHub has to a real usage number — stars are interest, downloads are use.\n\n" +
      "Pass `tag` for a single release, or `max` to cover the most recent N (default 20). " +
      "Counts cover uploaded RELEASE ASSETS only: source-tarball downloads, git clones (see github-repo-traffic) and package-registry installs (npm, PyPI, Docker Hub) are invisible to this endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        tag: { type: "string", description: "Fetch a single release by tag (e.g. v1.4.0) instead of the recent list." },
        max: { type: "number", description: "How many recent releases to include (default 20, cap 200)." },
        includeAssets: { type: "boolean", description: "Include the per-asset breakdown. Default true." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-repo-activity",
    readOnly: true,
    description:
      "Development activity from GitHub's computed stats: weekly commit volume, and the split between commits by the repo owner and commits from everyone else — the clearest single read on whether a project has a community or is a solo effort.\n\n" +
      "`metrics: [\"contributors\"]` adds the ranked contributor list with each person's first and last commit week and who is new in the last 90 days (rising maintainers, or a bus-factor warning). " +
      "These endpoints answer 202 while GitHub computes them; this tool polls through that, and says so in `notes` if the numbers are still not ready.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        metrics: {
          type: "array",
          items: { type: "string", enum: ["participation", "commit_activity", "contributors"] },
          description: "Which stats to fetch. Default: participation + commit_activity.",
        },
        weeks: { type: "number", description: "How many trailing weeks to summarise (default 12, max 52)." },
        topContributors: { type: "number", description: "How many contributors to list when metrics includes contributors (default 15)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-community-pulse",
    readOnly: true,
    description:
      "Community engagement over a window: issues and PRs opened, PRs merged, issues closed, who merged their FIRST contribution, and the median time to first response on recent issues. " +
      "This is the metric that separates 'trended on HN for a day' from 'people are actually building on this' — and slow first-response time is the most common reason early contributors never come back.\n\n" +
      "Pass `excludeLogins` with the maintainer usernames so the counts reflect outside activity rather than your own team. " +
      "Runs on the search API (30 requests/minute), so first-time-contributor checks are capped at 15 authors and response latency samples the most recent issues — both caps are reported in the payload rather than silently applied.",
    inputSchema: {
      type: "object",
      properties: {
        owner: OWNER_PROP,
        repo: REPO_PROP,
        days: { type: "number", description: "Window size in days (default 30, max 365)." },
        excludeLogins: { type: "array", items: { type: "string" }, description: "Maintainer usernames to exclude, so counts reflect outside contributors." },
        includeNewContributors: { type: "boolean", description: "Identify first-time contributors among merged-PR authors. Default true." },
        responseLatency: { type: "boolean", description: "Sample recent issues for time-to-first-response. Default true." },
        maxIssuesSampled: { type: "number", description: "How many recent issues to sample for latency (default 20, cap 50)." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github-compare-repos",
    readOnly: true,
    description:
      "Benchmark several repositories side by side: stars, forks, watchers, open issues, language, license, age, days since last push, and (by default) how many stars each gained in the last 30 days with the period-over-period change. " +
      "Use it to place a repo against its alternatives — absolute star counts say little without the comparison, and `relativeGrowthPct` (recent stars as a share of total) surfaces a small repo growing faster than a big one.\n\n" +
      "Accepts up to 10 repos as \"owner/repo\" strings. A repo that cannot be read comes back with an `error` field instead of failing the whole call.",
    inputSchema: {
      type: "object",
      properties: {
        repos: { type: "array", items: { type: "string" }, description: "Repositories to compare, as owner/repo strings. Max 10." },
        includeStarVelocity: { type: "boolean", description: "Include recent star velocity per repo. Default true." },
        velocityDays: { type: "number", description: "Star velocity window in days (default 30, max 180)." },
        includeReleases: { type: "boolean", description: "Include release count and total asset downloads. Default false." },
        includeActivity: { type: "boolean", description: "Include commits in the last 12 weeks. Default false." },
      },
      required: ["repos"],
    },
  },
];

// ── dispatch ────────────────────────────────────────────────────────────────

type InsightHandler = (
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
) => Promise<{ content: string; citations?: Citation[] }>;

const INSIGHT_HANDLERS: Record<string, InsightHandler> = {
  "github-list-stargazers": handleListStargazers,
  "github-star-history": handleStarHistory,
  "github-stargazer-profiles": handleStargazerProfiles,
  "github-repo-traffic": handleRepoTraffic,
  "github-repo-snapshot": handleRepoSnapshot,
  "github-list-forks": handleListForks,
  "github-release-downloads": handleReleaseDownloads,
  "github-repo-activity": handleRepoActivity,
  "github-community-pulse": handleCommunityPulse,
  "github-compare-repos": handleCompareRepos,
};

export function isGithubInsightsTool(tool: string): boolean {
  return Object.hasOwn(INSIGHT_HANDLERS, tool);
}

/** Route a github-* insights tool call. Throws for an unknown name. */
export async function handleGithubInsightsTool(
  tool: string,
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<{ content: string; citations?: Citation[] }> {
  const handler = INSIGHT_HANDLERS[tool];
  if (!handler) throw new Error(`Unknown GitHub insights tool: ${tool}`);
  return handler(credentials, params);
}
