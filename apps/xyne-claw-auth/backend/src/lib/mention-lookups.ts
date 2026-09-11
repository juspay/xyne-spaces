/**
 * Spaces-backed implementations of the MentionLookups used by
 * resolveUnboundMentions. Shared by every result-posting path that wants
 * deterministic tagging (webhook results, scheduled-job results) so the
 * lookup behavior can't drift between them.
 *
 * All lookups use take/limit=2 so a multi-match comes back as length 2 and
 * the resolver treats it as ambiguous (no rewrite, no false pings).
 */

import { CONFIG } from "../config.js";
import { errMsg } from "./errors.js";
import type { MentionLookups } from "./mention-transform.js";
import {
  getSpacesGroupByAlias,
  getSpacesUsersByName,
  getSpacesUserByEmail,
  getSpacesUsersByHandle,
  spacesDbAvailable,
} from "./spaces-db.js";
import { createLogger } from "../logger.js";

const log = createLogger("mention-lookups");

/**
 * DB-backed mention lookups — read `public.users` directly. PREFERRED over the
 * HTTP path because Spaces' `/api/query` + `/api/users/*` reject the agent's
 * app token (401), so headless runs (automations, event triggers, scheduled
 * jobs) could never resolve a name → user and posted plain `@Name` dead text.
 * The DB read needs no token and no workspace scope (email is @unique; names
 * resolve only when EXACTLY one active human matches). Used whenever
 * SPACES_DB_URL is configured; the HTTP builder below is the fallback.
 */
export function buildSpacesMentionLookupsDb(workspaceId?: string): MentionLookups {
  log.info(`[mention-lookups] using db lookups workspaceId=${workspaceId ?? "(none)"}`);
  return {
    // Scope ALL people lookups to the agent's workspace when known. Names AND
    // emails/handles collide across workspaces (the same person is imported into
    // multiple workspaces, one users row each), so an unscoped email/handle
    // returns ≥2 rows and the resolver leaves the @mention untagged — the prod
    // bug where @email never resolved while @Name did.
    byName: (name) => getSpacesUsersByName(name, workspaceId),
    byEmail: (email) => getSpacesUserByEmail(email, workspaceId),
    byHandle: (handle) => getSpacesUsersByHandle(handle, workspaceId),
    byGroupAlias: getSpacesGroupByAlias,
  };
}

export interface SpacesMentionAuth {
  /** Spaces user JWT of the human on whose behalf we search. */
  token: string;
  /** Session row id — sent as cookie for Spaces' legacy session checks. */
  sessionId?: string;
  /** Workspace scope for the searches. */
  workspaceId?: string;
}

export function buildSpacesMentionLookups(auth: SpacesMentionAuth): MentionLookups {
  // Prefer the direct-DB reader when available — it bypasses the app-token 401
  // that breaks tagging for headless runs, and needs no workspace/token. The
  // HTTP path below stays as the fallback for deployments without SPACES_DB_URL.
  if (spacesDbAvailable()) return buildSpacesMentionLookupsDb(auth.workspaceId);

  log.info(
    `[mention-lookups] using http lookups workspaceId=${auth.workspaceId ?? "(none)"} hasSession=${!!auth.sessionId}`,
  );

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
  };
  if (auth.sessionId) {
    baseHeaders["x-session-id"] = auth.sessionId;
    baseHeaders["Cookie"] = `xyne_session=${auth.sessionId}; user_session_id=${auth.sessionId}`;
  }
  if (auth.workspaceId) baseHeaders["x-workspace-id"] = auth.workspaceId;

  // POST /api/query (python query gateway, UsersACL). Used for the email/handle
  // paths (/api/users/search only matches name.startsWith and would miss both)
  // AND for the workspace-scoped name path in byName — unlike /api/users/search,
  // a `workspaceId` where-clause here actually scopes the result to the current
  // workspace, which is the whole point (see byName).
  const queryUsers = async (
    where: Record<string, unknown>,
  ): Promise<Array<{ id: string; name: string }>> => {
    try {
      const res = await fetch(`${CONFIG.spacesInternalUrl}/api/query`, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "user",
          operation: "findMany",
          where,
          take: 2,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log.warn(`[mention-lookups] queryUsers where=${JSON.stringify(where)} → HTTP ${res.status} body=${errBody.slice(0, 200)}`);
        return [];
      }
      const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
      const out = (body.data ?? []).map((u) => ({ id: u.id, name: u.name }));
      return out;
    } catch (err) {
      log.warn(`[mention-lookups] queryUsers where=${JSON.stringify(where)} threw: ${errMsg(err)}`);
      return [];
    }
  };

  // Group alias lookup. We read `public.user_groups` DIRECTLY (spaces-db) rather
  // than via /api/query — that gateway forbids the `userGroup` model ("Model
  // userGroup is not allowed for querying"), and the group-read REST routes were
  // removed (reads moved to Zero/zql), so there is no HTTP path. `alias` is
  // globally @unique (no workspace column), so this is unambiguous (0 or 1) and
  // needs no auth/workspace scoping. See getSpacesGroupByAlias.
  const queryGroupsByAlias = async (
    alias: string,
  ): Promise<Array<{ id: string; name: string; alias?: string | null }>> => {
    const out = await getSpacesGroupByAlias(alias);
    log.info(`[mention-lookups] byGroupAlias alias="${alias}" → ${out.length} match(es) ids=[${out.map((g) => g.id).join(",")}]`);
    return out;
  };

  return {
    // Name lookup. PRIMARY path is a WORKSPACE-SCOPED exact match via
    // /api/query — because /api/users/search is NOT workspace-scoped and returns
    // same-name accounts from OTHER workspaces (e.g. a Slack/cross-platform
    // import: "Satvik Batra <…@cross-platform.in>" alongside the real
    // "Satvik Batra <…@juspay.in>"). Those exact-name collisions made every
    // common name look ambiguous (length≥2) and never tag — the prod bug. The
    // workspace filter collapses them to the actual member. Falls back to the
    // unscoped prefix search only when there's no workspace context or no
    // scoped hit (e.g. the written name is a prefix of the stored display name).
    byName: async (name) => {
      if (auth.workspaceId) {
        const scoped = await queryUsers({
          name: { equals: name, mode: "insensitive" },
          workspaceId: { equals: auth.workspaceId },
        });
        if (scoped.length >= 1) return scoped.slice(0, 2);
        // No scoped exact hit — fall through to the prefix search below.
      }
      // Fetch several prefix matches (not just 2) so we can detect an EXACT
      // name match hiding among longer prefix-shares. The search is
      // name.startsWith, so "Anurag Dwivedi" also returns
      // "Anurag Dwivedi (Playwright)"; without exact-preference that pair looks
      // ambiguous and never tags. Cap stays small.
      const qs = new URLSearchParams({ q: name, limit: "10" });
      const url = `${CONFIG.spacesInternalUrl}/api/users/search?${qs.toString()}`;
      try {
        const res = await fetch(url, {
          headers: baseHeaders,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          // Previously swallowed silently — the #1 reason a tag mysteriously
          // never happens in prod (auth / workspace-scope / 404). Log it.
          const errBody = await res.text().catch(() => "");
          log.warn(`[mention-lookups] byName q="${name}" → HTTP ${res.status} ${res.statusText} body=${errBody.slice(0, 200)}`);
          return [];
        }
        const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
        const all = body.data ?? [];
        // Prefer an exact (case-insensitive) name match: a single exact hit
        // wins over longer names that merely share the prefix. Falls back to
        // the first two prefix matches (resolver treats length>=2 as ambiguous,
        // so genuine same-name duplicates are still left untagged — correct).
        const target = name.trim().toLowerCase();
        const exact = all.filter((u) => (u.name ?? "").trim().toLowerCase() === target);
        const result = (exact.length >= 1 ? exact : all).slice(0, 2);
        return result;
      } catch (err) {
        // Previously swallowed — surfaces timeouts/DNS/abort that only happen in prod.
        log.warn(`[mention-lookups] byName q="${name}" threw: ${errMsg(err)}`);
        return [];
      }
    },
    // Scope to the workspace when known — the same email/handle exists in
    // multiple workspaces (cross-workspace import), so unscoped it returns ≥2
    // rows and the mention is left untagged. Mirrors byName's workspace filter.
    byEmail: (email) => queryUsers({
      email: { equals: email, mode: "insensitive" },
      ...(auth.workspaceId ? { workspaceId: { equals: auth.workspaceId } } : {}),
    }),
    // Dotted handle (`bowmitha.c`) = email local-part → match on the prefix
    // up to and including the `@` so `bowmitha.c` can't match `bowmitha.cs@…`.
    byHandle: (handle) => queryUsers({
      email: { startsWith: `${handle}@`, mode: "insensitive" },
      ...(auth.workspaceId ? { workspaceId: { equals: auth.workspaceId } } : {}),
    }),
    byGroupAlias: (alias) => queryGroupsByAlias(alias),
  };
}
