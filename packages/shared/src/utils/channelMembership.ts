/**
 * Resolve a regular channel's member ids for the @-mention picker.
 *
 * Returns `null` while membership is still UNKNOWN, so the picker shows no
 * "Not in channel" pill instead of flagging every user (including the viewer)
 * as a non-member during load.
 *
 * - `vespaIds`: `null` = Vespa not fetched yet; `[]` = fetched but empty.
 * - `dbIds`: the channel_participants fallback (only queried when Vespa came
 *   back empty). Zero returns `[]` for a disabled or still-hydrating query, so
 *   these rows only count once `dbComplete` is true.
 */
export function resolveChannelMemberIds(
  vespaIds: readonly string[] | null,
  dbIds: readonly string[] | null | undefined,
  dbComplete: boolean,
): readonly string[] | null {
  if (vespaIds === null) return null;
  if (vespaIds.length > 0) return vespaIds;
  if (!dbComplete || !dbIds) return null;
  return dbIds;
}
