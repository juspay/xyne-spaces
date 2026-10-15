export type AppliedTicketLabel = {
  /**
   * `ticket_tag_mappings.id` — primary delete key.
   * Note: `ticket_tag_mappings.tagId` is `project_tags.id`, not legacy
   * `ticket_tags.id`. Create's `tagId` is not available on mapping rows.
   */
  mappingId: string;
  name: string;
};

type TagMappingRow = {
  id?: string | null | undefined;
  tagName?: string | null | undefined;
};

export function mapAppliedLabels(
  tagMappings: ReadonlyArray<TagMappingRow> | null | undefined,
): AppliedTicketLabel[] {
  const list: AppliedTicketLabel[] = [];
  for (const mapping of tagMappings ?? []) {
    const mappingId = (mapping.id ?? '').trim();
    const name = (mapping.tagName ?? '').trim();
    if (!mappingId || !name) continue;
    list.push({ mappingId, name });
  }
  return list;
}

/**
 * Args for `mutators.ticketTagV2.delete`.
 *
 * Shared mutator contract (`ticketTagV2.delete` in `@xyne/shared`):
 * - Removes the mapping by `mappingId`.
 * - Resolves legacy `ticket_tags` via mapping.ticketId + mapping.tagName
 *   (not via the `tagId` argument — that is not `ticket_tags.id`).
 * - `tagId` stays required for deployed server schema validation; pass the
 *   mapping id (dashboard parity). Do not invent a separate tagId from
 *   mapping rows — `mapping.tagId` is `project_tags.id`.
 */
export function buildTicketTagV2DeleteArgs(mappingId: string): {
  tagId: string;
  mappingId: string;
} {
  const id = mappingId.trim();
  return { tagId: id, mappingId: id };
}

const normalizeLabelKey = (name: string): string => name.trim().toLowerCase();

export type LabelConfirmDiff = {
  removals: AppliedTicketLabel[];
  additions: string[];
};

/** Diff picker confirmation against currently applied labels. */
export function diffLabelConfirmChanges(
  appliedLabels: readonly AppliedTicketLabel[],
  nextNames: readonly string[],
): LabelConfirmDiff {
  const nextNormalized = new Set(nextNames.map(name => normalizeLabelKey(name)).filter(Boolean));

  const removals = appliedLabels.filter(
    applied => !nextNormalized.has(normalizeLabelKey(applied.name)),
  );

  const additions: string[] = [];
  const seenAdditions = new Set<string>();
  for (const name of nextNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = normalizeLabelKey(trimmed);
    if (seenAdditions.has(key)) continue;
    seenAdditions.add(key);
    const alreadyApplied = appliedLabels.some(label => normalizeLabelKey(label.name) === key);
    if (!alreadyApplied) additions.push(trimmed);
  }

  return { removals, additions };
}
