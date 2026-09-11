/**
 * Vespa search for Search Evals — BOTH permission modes. Lives entirely in
 * xyne-claw-auth; the main xyne-spaces backend is never called for this (no
 * `/api/vespaSearch/claw`, no real cmd+k code path involved at all). That's a
 * deliberate choice: this file is the single source of truth for how a
 * Search Evals query gets built, for both modes, so there's exactly one
 * thing to keep correct instead of two.
 *
 * - "with" permission: the real per-user ACL guard (permissions contains
 *   <userId>, same clause aclConditionForSchema()/ACL.* in vespa-direct.ts
 *   use) — `userId` is xyne-claw-auth's internal user id, which is JIT-
 *   mirrored to equal the Spaces user id, so it's usable directly as the ACL
 *   value without a Spaces session/token.
 * - "without" permission: publicOnlyConditionForSchema() instead — public
 *   content only (isPrivate == false), no real user checked at all. Private
 *   channels, DMs, and anything member-scoped are never returned.
 * Workspace isolation is NOT skippable either way (buildYqlFromParams always
 * ANDs `workspaceId contains "<workspaceId>"`), so neither mode crosses tenants.
 *
 * Known consequences of not calling the real backend:
 *   - "All types" IS one federated Vespa query (buildFederatedYqlFromParams()
 *     — `from sources chat_message, file, ticket, chat_container, mail where
 *     (<area1>) or (<area2>) or ...`, mirroring how the real backend's
 *     YqlBuilder federates), not N separate queries — Vespa itself ranks and
 *     caps to `hits`, no client-side re-sort/merge needed. The one real
 *     limitation: Vespa applies a single ranking.profile to the whole query,
 *     so only "default_native" (present on every involved schema) is valid
 *     there — no per-type tunable/personalized/etc.
 *   - "calls" has no SEARCH_AREA in vespa-search-areas.ts at all (the `call`
 *     schema was never ported here) — unsupported in both modes now; requesting
 *     it throws rather than silently returning zero/wrong results.
 *   - "emails"/mail has no public/private concept (every email has a fixed
 *     recipient set) — publicOnlyConditionForSchema() makes that area always
 *     match zero documents under "without" rather than throwing, so an "All
 *     types" run there still returns the other areas' public results.
 *
 * Reuses the existing, production-tested building blocks rather than
 * re-deriving query construction from scratch:
 *   - buildYqlFromParams() (./vespa-search-areas.ts) — same field registry,
 *     docType/subApp scoping, date-literal shaping and rank-profile selection
 *     the `spaces-vespa-search` MCP tool uses.
 *   - convertDateLiteralsToMs / defaultNativeInputs / callVespa / transformHit
 *     (./vespa-direct.ts) — the same date conversion, embedding-input and
 *     result-shaping logic queryDirect() uses. queryDirect() itself is NOT
 *     used here since its ACL injection is unconditional by design (it backs
 *     the live agent-facing tools) and can't be told to use publicOnly mode.
 *
 * Supported entity types mirror the dashboard's real cmd+k type filter
 * (dashboard/.../ChannelCommandMenu.types.ts DOC_TYPE_REGISTRY / SearchFilterBar
 * TYPE_OPTIONS) minus "people": cmd+k resolves People entirely client-side from
 * the local user list (LOCAL_TYPES in searchFilterParser.ts) and never queries
 * Vespa for it, so there's no real search-relevance result to score.
 */
import { CONFIG } from "../../config.js";
import { buildYqlFromParams, buildFederatedYqlFromParams, type StructuredQueryParams } from "./vespa-search-areas.js";
import { convertDateLiteralsToMs, defaultNativeInputs, callVespa, transformHit, type SearchResult } from "./vespa-direct.js";

// Exported for the rank-profiles route (vespa-schema-profiles.ts +
// routes/search-evals/rank-profiles.ts) to map a UI entity type to the
// SearchArea whose .sd schema it should list live rank-profiles from.
export const TYPE_TO_AREA: Record<string, string> = {
  messages: "message",
  files: "file",
  tickets: "ticket",
  channels: "channel",
  emails: "mail",
};

export const ALL_AREAS = Object.values(TYPE_TO_AREA);

// Mirrors vespa-direct.ts's (unexported) IST_OFFSET_MS — kept in lockstep so
// the literal this produces round-trips through convertDateLiteralsToMs back
// to the exact same UTC instant.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Absolute-instant ISO string (e.g. "2026-07-20T09:00:00.000Z", as produced
 *  by `new Date(datetimeLocal).toISOString()` on the frontend) → the
 *  "DD/MM/YYYY HH:MM" IST-wall-clock literal buildYqlFromParams' dateField
 *  filters require. convertDateLiteralsToMs() re-parses that literal as IST
 *  and subtracts the same offset, so this must ADD it first to preserve the
 *  original instant — a naive substring copy would silently shift by 5:30. */
function toDateLiteral(isoUtc: string): string {
  const ms = new Date(isoUtc.trim()).getTime();
  if (Number.isNaN(ms)) throw new Error(`Invalid "before" timestamp "${isoUtc}".`);
  const ist = new Date(ms + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dd = pad(ist.getUTCDate());
  const mm = pad(ist.getUTCMonth() + 1);
  const yyyy = ist.getUTCFullYear();
  const HH = pad(ist.getUTCHours());
  const MI = pad(ist.getUTCMinutes());
  return `${dd}/${mm}/${yyyy} ${HH}:${MI}`;
}

export interface SearchEvalVespaParams {
  q: string;
  /** Comma list of eval entity types ("messages,files"), or "" / undefined for all types. */
  type?: string;
  /** datetime-local string ("YYYY-MM-DDTHH:MM") — results must be at/before this. */
  before?: string;
  /** Explicit rank profile name, applied to the built query as-is (see the
   *  searchEvalVespa comment above) rather than through buildYqlFromParams'
   *  allow-list, since the eval UI's dropdown sources valid names live from
   *  vespa-schema-profiles.ts, or a free-typed "Custom…" name — either way a
   *  name that doesn't exist on the queried schema just fails at Vespa.
   *  Undefined/"" → buildYqlFromParams auto-picks (default_native for scored
   *  text). */
  rankProfile?: string;
  workspaceId: string;
  limit?: number;
  /** "with" = real per-user ACL (permissions contains userId) — "without" =
   *  public-only, no real user checked. */
  permissionMode: "with" | "without";
  /** Required when permissionMode === "with" — xyne-claw-auth's internal user
   *  id, used directly as the ACL value (JIT-mirrored to equal the Spaces
   *  user id, so no session/token lookup is needed). */
  userId?: string;
  /** Overrides for default_native's tunable weights (alpha, freshness_weight,
   *  filtering_weight — see defaultNativeInputs() in vespa-direct.ts). Merged
   *  on top of the defaults; only takes effect when the resolved rank profile
   *  is a scored one (not "unranked") — matches how defaultNativeInputs itself
   *  is only applied then. */
  rankProfileInputs?: Record<string, number>;
}

interface DebugPayload { stage: string; yql: string; vespaParams: Record<string, unknown> }

/**
 * One entity type → buildYqlFromParams (single `from sources <schema>`).
 * Multiple entity types (incl. "All types", the default) → ONE federated
 * query via buildFederatedYqlFromParams (`from sources <schema1>, <schema2>,
 * ... where (<area1>) or (<area2>) or ...`), same as how the real backend's
 * YqlBuilder federates multiple schemas into one YQL statement — NOT N
 * separate single-schema queries merge-ranked client-side (Vespa itself ranks
 * and caps the federated result set to `hits`). Same shape as
 * DirectSearchResponse (queryDirect's return type) so callers can treat both
 * search paths uniformly.
 */
export async function searchEvalVespa(
  params: SearchEvalVespaParams,
): Promise<{ success: true; data: { grouped: false; results: SearchResult[]; debug: { payloads: DebugPayload[] } } }> {
  if (params.permissionMode === "with" && !params.userId) {
    throw new Error(`searchEvalVespa: userId is required when permissionMode is "with".`);
  }

  const requestedTypes = (params.type ?? "")
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  if (requestedTypes.includes("calls")) {
    throw new Error(
      `"calls" is not supported — no SEARCH_AREA for the call schema exists in vespa-search-areas.ts.`,
    );
  }

  const unknownTypes = requestedTypes.filter(t => !TYPE_TO_AREA[t]);
  if (unknownTypes.length > 0) {
    throw new Error(`Unsupported entity type(s): ${unknownTypes.join(", ")}.`);
  }

  const areas = requestedTypes.length > 0 ? requestedTypes.map(t => TYPE_TO_AREA[t]!) : ALL_AREAS;
  const limit = params.limit ?? 10;

  // buildYqlFromParams/buildFederatedYqlFromParams (vespa-search-areas.ts) allow-list
  // params.rankProfile against a hardcoded per-area list — deliberately NOT bypassed
  // here (that validation also guards the production agent-facing search MCP tool,
  // xyne-spaces-tools.ts, which shares these builders). Instead: only forward
  // rankProfile through when it's "unranked" — always allow-listed everywhere, and
  // the one value buildAreaClauses' `scored` flag treats specially (it decides
  // whether to add the nearestNeighbor/embedding clause off `rankProfile !==
  // "unranked"`, read from `params`, so an actually-unranked custom profile needs to
  // reach that check as literally "unranked" to skip the vector clause correctly).
  // Any OTHER custom/live-discovered name is withheld from the builder call — it
  // auto-picks its own default_native/unranked (always allow-listed, and `scored`
  // still resolves correctly since "not unranked" holds either way) — and is applied
  // to the built query's `rankProfile` field directly below, post-validation.
  const commonParams: Omit<StructuredQueryParams, "searchArea"> = {
    query: params.q,
    hits: limit,
    ...(params.before ? { filters: { createdDate: { lte: toDateLiteral(params.before) } } } : {}),
    ...(params.rankProfile === "unranked" ? { rankProfile: "unranked" as const } : {}),
  };

  const built =
    areas.length === 1
      ? params.permissionMode === "with"
        ? buildYqlFromParams({ ...commonParams, searchArea: areas[0]! }, params.userId!, params.workspaceId)
        : buildYqlFromParams({ ...commonParams, searchArea: areas[0]! }, "search-eval-public-only", params.workspaceId, { publicOnly: true })
      : params.permissionMode === "with"
        ? buildFederatedYqlFromParams(areas, commonParams, params.userId!, params.workspaceId)
        : buildFederatedYqlFromParams(areas, commonParams, "search-eval-public-only", params.workspaceId, { publicOnly: true });

  // The actual rank profile to send to Vespa is always the eval caller's raw choice
  // when one was given (not allow-listed — see the comment above); a name that
  // doesn't exist on the queried schema just fails at Vespa (400), surfaced
  // per-query in the eval UI.
  if (params.rankProfile) built.rankProfile = params.rankProfile;

  const datedYql = convertDateLiteralsToMs(built.yql);
  const stageLabel = areas.length === 1 ? areas[0]! : `federated (${areas.join(", ")})`;

  const profile = built.rankProfile ?? "unranked";
  const payload: Record<string, unknown> = {
    yql: datedYql,
    query: built.query || "",
    hits: limit,
    offset: 0,
    timeout: "30s",
    tracelevel: 0,
    "ranking.profile": profile,
  };
  if (profile !== "unranked") {
    Object.assign(payload, defaultNativeInputs(built.query));
    // Tunable overrides ("Tunable" rank profile option in the UI) win over
    // the defaults just applied — plain keys map onto the same
    // input.query(<name>) params. Only meaningful for a single-type run
    // ("All types" is locked to default_native, which never surfaces this).
    if (params.rankProfileInputs) {
      for (const [k, v] of Object.entries(params.rankProfileInputs)) {
        payload[`input.query(${k})`] = v;
      }
    }
  }

  const debugPayloads: DebugPayload[] = [{ stage: stageLabel, yql: datedYql, vespaParams: payload }];

  const raw = await callVespa(payload, CONFIG.vespaQueryEndpoint);
  const root = (raw["root"] ?? {}) as Record<string, unknown>;
  const children = Array.isArray(root["children"]) ? (root["children"] as Record<string, unknown>[]) : [];
  const allResults = children.map(h => transformHit(h));

  return {
    success: true,
    data: { grouped: false, results: allResults.slice(0, limit), debug: { payloads: debugPayloads } },
  };
}
