import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("error-pipeline");

/**
 * Bucket routing rules, read STRAIGHT from the error_buckets table (this
 * service owns it — the old claw-side S2S fetch + stale-ok cache is gone).
 * A short in-memory cache keeps ingest bursts from hammering Postgres; admin
 * edits still go live within ~60s.
 */

export interface CompiledBucket {
  name: string;
  keywords: RegExp | null; // literal phrases, case-insensitive
  markers: RegExp | null;  // advanced raw regex, case-sensitive
}

const TTL_MS = 60_000;
const cached = new Map<string, { rules: CompiledBucket[] | null; fetchedAt: number }>();

function compileMarkers(src: string): RegExp | null {
  if (!src) return null;
  try {
    return new RegExp(src);
  } catch (err) {
    log.error(`[rules] invalid regex in DB (skipped): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Literal phrases → one case-insensitive alternation, each term escaped. */
function compileKeywords(keywords: string[]): RegExp | null {
  const parts = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (parts.length === 0) return null;
  try {
    return new RegExp(parts.join("|"), "i");
  } catch {
    return null;
  }
}

export async function laneNames(orgId: string): Promise<string[]> {
  const rules = await getRules(orgId);
  const names = rules?.map((r) => r.name) ?? [];
  if (!names.includes("default")) names.push("default");
  return names;
}

/** Current compiled bucket rules, in matchOrder. Stale-ok on DB errors. */
export async function getRules(orgId: string): Promise<CompiledBucket[] | null> {
  const previous = cached.get(orgId);
  if (previous && Date.now() - previous.fetchedAt < TTL_MS) return previous.rules;
  try {
    const rows = await prisma.errorBucket.findMany({
      where: { orgId, enabled: true },
      orderBy: { matchOrder: "asc" },
      select: { name: true, keywords: true, markers: true },
    });
    const rules = rows.map((b) => ({
      name: b.name,
      keywords: compileKeywords(b.keywords),
      markers: compileMarkers(b.markers),
    }));
    cached.set(orgId, { rules, fetchedAt: Date.now() });
  } catch (err) {
    log.warn(`[rules] DB read failed (${err instanceof Error ? err.message : String(err)}) — keeping previous rules`);
    cached.set(orgId, { rules: previous?.rules ?? null, fetchedAt: Date.now() }); // back off — don't hammer a down DB per error
  }
  return cached.get(orgId)?.rules ?? null;
}
