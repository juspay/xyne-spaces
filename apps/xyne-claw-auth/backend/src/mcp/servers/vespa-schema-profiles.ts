/**
 * Live rank-profile discovery — fetches each schema's actually-deployed .sd
 * text straight from Vespa's config server and regexes out `rank-profile
 * <name>` declarations, instead of hand-maintaining a list that drifts (the
 * old MESSAGE_RANK_PROFILES-style arrays in vespa-search-areas.ts — kept
 * there as inert reference, no longer used to validate/populate anything).
 * A profile added to a .sd and redeployed shows up here immediately, no code
 * change needed.
 *
 * Cached in-memory per schema (CACHE_TTL_MS) so a burst of requests (e.g. the
 * eval UI's "Entity type" switcher) doesn't hammer the config server, while
 * still picking up a redeploy without restarting this service.
 */
import { CONFIG } from "../../config.js";
import { createLogger } from "../../logger.js";

const log = createLogger("vespa-schema-profiles");

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { profiles: string[]; fetchedAt: number }>();

function schemaContentUrl(schema: string): string {
  return `${CONFIG.vespaConfigEndpoint}/application/v2/tenant/${CONFIG.vespaConfigTenant}` +
    `/application/${CONFIG.vespaConfigApplication}/environment/${CONFIG.vespaConfigEnvironment}` +
    `/region/${CONFIG.vespaConfigRegion}/instance/${CONFIG.vespaConfigInstance}` +
    `/content/schemas/${schema}.sd`;
}

/**
 * Parses `rank-profile <name>` declarations out of raw .sd text — skips
 * commented-out lines (e.g. ticket.sd has a `# rank-profile global_sorted
 * inherits initial {` left in as a note) and dedupes/sorts for a stable list.
 * Exported standalone so it's testable without a live Vespa config server.
 */
export function parseRankProfileNames(sdText: string): string[] {
  const names = new Set<string>();
  for (const rawLine of sdText.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const m = line.match(/^rank-profile\s+([A-Za-z0-9_]+)/);
    if (m && m[1]) names.add(m[1]);
  }
  return Array.from(names).sort();
}

/**
 * Live rank-profile names declared on `schema` (the .sd base name — matches
 * SearchArea.source, e.g. "mail", "ticket", "file"). Throws if the config
 * server is unreachable or the schema doesn't exist there; callers decide
 * how to degrade (the route below falls back to BASE_RANK_PROFILES).
 */
export async function getSchemaRankProfiles(schema: string): Promise<string[]> {
  const cached = cache.get(schema);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.profiles;

  const url = schemaContentUrl(schema);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Vespa config server returned ${res.status} for schema "${schema}" (${url})`);
  }
  const text = await res.text();
  const profiles = parseRankProfileNames(text);
  cache.set(schema, { profiles, fetchedAt: Date.now() });
  log.info(`[vespa-schema-profiles] ${schema}: ${profiles.join(", ")}`);
  return profiles;
}

/** Rank profiles common to every one of `schemas` — the only ones safe to
 *  pick for a federated ("All types") query, since Vespa applies exactly ONE
 *  ranking.profile across all merged sources. Schemas that fail to fetch are
 *  logged and excluded from the intersection (rather than failing the whole
 *  call) so one bad/renamed schema doesn't blank out the entire list. */
export async function getCommonRankProfiles(schemas: string[]): Promise<string[]> {
  const perSchema = await Promise.all(
    schemas.map(async (schema) => {
      try {
        return await getSchemaRankProfiles(schema);
      } catch (err) {
        log.error(`[vespa-schema-profiles] failed to fetch "${schema}":`, err instanceof Error ? err.message : err);
        return null;
      }
    }),
  );
  const lists = perSchema.filter((p): p is string[] => p !== null);
  if (lists.length === 0) return [];
  return lists.reduce((common, list) => common.filter((p) => list.includes(p)));
}

/** Clears the cache — call after a known Vespa redeploy, or from a test. */
export function clearSchemaRankProfilesCache(): void {
  cache.clear();
}
