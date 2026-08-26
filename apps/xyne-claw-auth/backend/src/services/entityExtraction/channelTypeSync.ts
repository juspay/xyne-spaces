/**
 * Write a channel's approved entity types back to Vespa.
 *
 * Two fields are written, both mirrors of what type discovery produced and a
 * human approved:
 *   - entityTypes    — array<string> of names, indexed, for search filtering
 *                      (`where entityTypes contains "GATEWAY"`)
 *   - entityTypeDefs — a JSON string of the FULL definitions
 *                      ([{ name, rule, examples }]), summary-only, fetched whole
 *                      and handed to the mention extractor which needs each
 *                      type's rule + few-shot examples.
 * Both come off the same narrowed set, so they never disagree.
 *
 * Postgres stays the source of truth. This is a projection: if the write fails,
 * the approval still stands and can be re-synced.
 *
 * The write is a PARTIAL update (`{"assign": ...}`) against the document API,
 * so it touches only these two fields and cannot clobber channelName,
 * permissions or anything else on the channel document. Note the reverse is NOT
 * guaranteed: a full re-put of a channel doc by ingest that omits them WILL
 * clear them (documented on the fields in chat_container.sd) — resyncChannelTypes
 * exists to repair that.
 */

import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { prisma } from "../../db.js";
import { createLogger, createTraceId } from "../../logger.js";

const logger = createLogger("entity-type-sync", createTraceId());

const CHANNEL_SCHEMA = "chat_container";
const FEED_TIMEOUT_MS = 15_000;

/** A type as written into the `entityTypeDefs` JSON blob. */
export interface ChannelEntityTypeDef {
  name: string;
  rule: string;
  examples: string[];
}

export interface TypeSyncResult {
  ok: boolean;
  /** The type names as written (or as they would have been written). */
  entityTypes: string[];
  error?: string;
}

/**
 * The channel's full approved vocabulary: the union of what every completed run
 * on this channel approved, narrowed to types that are still APPROVED at the
 * workspace level, ordered by name.
 *
 * The narrowing matters — a type deprecated after approval must drop out of the
 * channel's Vespa set on the next sync, otherwise search keeps offering a filter
 * value that no longer resolves to anything.
 *
 * Returns the full definitions; callers that only need names read `.name`.
 */
export async function channelTypeDefs(
  workspaceId: string,
  channelId: string,
): Promise<ChannelEntityTypeDef[]> {
  const runs = await prisma.entityExtractionRun.findMany({
    where: { workspaceId, channelId },
    select: { approvedTypeNames: true },
  });
  const approvedOnChannel = new Set(runs.flatMap((r) => r.approvedTypeNames));
  if (approvedOnChannel.size === 0) return [];

  const live = await prisma.entityTypeDefinition.findMany({
    where: { workspaceId, status: "APPROVED", name: { in: [...approvedOnChannel] } },
    select: { name: true, rule: true, examples: true },
    orderBy: { name: "asc" },
  });
  return live.map((t) => ({ name: t.name, rule: t.rule, examples: t.examples }));
}

/** Names only — the search-filter projection. */
export async function channelTypeNames(
  workspaceId: string,
  channelId: string,
): Promise<string[]> {
  return (await channelTypeDefs(workspaceId, channelId)).map((t) => t.name);
}

/**
 * Recompute and push the channel's type set to Vespa. Never throws — callers
 * are mid-approval and the Postgres write has already committed.
 */
export async function syncChannelTypes(
  workspaceId: string,
  channelId: string,
): Promise<TypeSyncResult> {
  let entityTypes: string[] = [];
  try {
    const defs = await channelTypeDefs(workspaceId, channelId);
    entityTypes = defs.map((t) => t.name);
    await assignEntityTypes(channelId, defs);
    logger.info("[entity-type-sync] channel types written", {
      workspaceId,
      channelId,
      count: entityTypes.length,
      entityTypes,
    });
    return { ok: true, entityTypes };
  } catch (err) {
    const error = errMsg(err);
    // Deliberately not rethrown: the types are committed in Postgres and the
    // channel doc is a projection. Surfaced in the API response instead.
    logger.error("[entity-type-sync] channel type write failed", {
      workspaceId,
      channelId,
      entityTypes,
      error,
    });
    return { ok: false, entityTypes, error };
  }
}

/**
 * PUT a partial update assigning both the name list (`entityTypes`, searchable)
 * and the full JSON definitions (`entityTypeDefs`, summary-only) on the channel
 * document. One request, so the two projections are always consistent.
 */
async function assignEntityTypes(
  channelId: string,
  defs: ChannelEntityTypeDef[],
): Promise<void> {
  const url =
    `${CONFIG.vespaFeedEndpoint}/document/v1/${encodeURIComponent(CONFIG.vespaNamespace)}` +
    `/${CHANNEL_SCHEMA}/docid/${encodeURIComponent(channelId)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        entityTypes: { assign: defs.map((t) => t.name) },
        entityTypeDefs: { assign: JSON.stringify(defs) },
      },
    }),
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A 400 here almost always means the deployed chat_container schema is
    // missing `entityTypes`/`entityTypeDefs` — the vespa-core app package needs
    // redeploying.
    throw new Error(`Vespa document update ${res.status}: ${body.slice(0, 400)}`);
  }
}
