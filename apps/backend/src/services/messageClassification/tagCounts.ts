/**
 * How many threads carry each tag.
 *
 * One grouped Vespa query for the whole vocabulary, not a query per name: the review table
 * lists every candidate at once, so per-name counting would be a round trip per row.
 *
 * `threadType` is written only onto a thread's ROOT message
 * (zero/vespa-injection/core/mapper.ts), so a group's count is a THREAD count — no dedupe.
 * Free-form names are indexed before approval, so a candidate has a count from the moment
 * someone applies it.
 */
import { vespaClient } from '@/services/vespaSearch';
import { messageSchema } from '@/vespa/src/types';
import { escapeYqlString } from '@/utils/yqlEscape';
import { logger } from '@/utils/logger';

const TAG = '[TagCounts]';

/** Ceiling on distinct tag names returned. Comfortably above MAX_ENTRIES plus candidates. */
const MAX_TAG_GROUPS = 500;

export interface TagThreadCounts {
  /** name -> threads carrying it, across the whole workspace. */
  total: Map<string, number>;
  /** name -> epoch ms of the newest thread carrying it. Free, from the same grouping. */
  lastUsed: Map<string, number>;
  /**
   * False when the query failed — Vespa down, or the schema missing `threadType`.
   *
   * Without this an empty map is indistinguishable from "every tag is on zero threads", and
   * the review screen would tell an admin a widely-used tag is unused. The caller must omit
   * the counts entirely rather than send zeros.
   */
  ok: boolean;
}

/**
 * Raw YQL rather than searchService, deliberately.
 *
 * Every path through YqlBuilder ANDs in `permissions contains <userId>`, which is right for
 * search and wrong for this: an admin deciding whether a tag earns a place in the vocabulary
 * needs to know it is used on 41 threads, not on the 12 they happen to be a member of. A
 * count that silently reads 0 because the reviewer is not in the channel is worse than no
 * count at all.
 *
 * What that discloses is a tag name and a number — never a message, a thread, or a channel,
 * and no list is ever opened from it.
 */
const groupedCounts = async (
  workspaceId: string,
): Promise<{ counts: Map<string, number>; lastUsed: Map<string, number>; ok: boolean }> => {
  const counts = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  let ok = true;

  const where = [
    `docType contains "message"`,
    `workspaceId contains "${escapeYqlString(workspaceId)}"`,
  ].join(' and ');

  try {
    const response = await vespaClient.search<{
      root?: { children?: unknown[] };
    }>({
      yql:
        `select * from sources ${messageSchema} where ${where} ` +
        `| all(group(threadType) max(${MAX_TAG_GROUPS}) each(output(count(), max(createdAtTimestamp))))`,
      // Grouping only — the hit list is not wanted and would be pure transfer cost.
      hits: 0,
      'ranking.profile': 'unranked',
    });

    // Vespa nests grouplists arbitrarily deep depending on the query shape, so walk rather
    // than index into a fixed path.
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      const value = record['value'];
      const fields = record['fields'] as Record<string, unknown> | undefined;
      const count = fields?.['count()'];
      if (typeof value === 'string' && typeof count === 'number') {
        counts.set(value, count);
        // Already epoch ms — the mapper writes Date.getTime() into it (mapper.ts toTimestamp).
        const newest = fields?.['max(createdAtTimestamp)'];
        if (typeof newest === 'number' && newest > 0) lastUsed.set(value, newest);
      }
      for (const child of (record['children'] as unknown[] | undefined) ?? []) walk(child);
    };
    for (const child of response.root?.children ?? []) walk(child);
  } catch (error) {
    // A missing count renders as an em dash; it must never take the review screen down.
    ok = false;
    logger.error(`${TAG} Grouped count failed`, { workspaceId, error });
  }

  return { counts, lastUsed, ok };
};

/** One grouped query for the whole vocabulary. */
export async function threadCountsByTag(workspaceId: string): Promise<TagThreadCounts> {
  const { counts, lastUsed, ok } = await groupedCounts(workspaceId);
  return { total: counts, lastUsed, ok };
}
