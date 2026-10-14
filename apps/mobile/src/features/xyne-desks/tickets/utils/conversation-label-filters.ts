export type ConversationLabelRowLike = {
  id?: string | null;
  name?: string | null;
};

export type ConversationLabelFilterOption = {
  id: string;
  label: string;
};

export type TicketConversationLabelMappingLike = {
  labelId?: string | null;
};

export type TicketWithConversationLabelsLike = {
  id: string;
  conversationLabelMappings?: ReadonlyArray<TicketConversationLabelMappingLike | null> | null;
};

/** True only when shared clones `conversationLabelsByChannelId`. */
export function hasConversationLabelsQuery(queriesLike: object): boolean {
  return (
    typeof (queriesLike as { conversationLabelsByChannelId?: unknown })
      .conversationLabelsByChannelId === 'function'
  );
}

export function mapConversationLabelRowsToFilterOptions(
  rows: readonly ConversationLabelRowLike[] | null | undefined,
): ConversationLabelFilterOption[] {
  const options: ConversationLabelFilterOption[] = [];
  for (const row of rows ?? []) {
    const id = row.id?.trim();
    if (!id) continue;
    options.push({
      id,
      label: row.name?.trim() || 'Untitled label',
    });
  }
  return options;
}

/** Keep the row when it carries `labelId`. No filter → keep every row. */
export function ticketMatchesConversationLabel(
  row: TicketWithConversationLabelsLike,
  labelId: string | undefined,
): boolean {
  if (!labelId) return true;
  return (row.conversationLabelMappings ?? []).some(mapping => mapping?.labelId === labelId);
}

export function filterTicketsByConversationLabel<T extends TicketWithConversationLabelsLike>(
  rows: readonly T[],
  labelId: string | undefined,
): T[] {
  if (!labelId) return [...rows];
  return rows.filter(row => ticketMatchesConversationLabel(row, labelId));
}

/**
 * V4 accepts one `conversationLabelId`. A second tap replaces the first;
 * applying two ids keeps only the last non-empty one.
 */
export function toggleSingleSelectDraft(currentIds: readonly string[], nextId: string): string[] {
  return currentIds.includes(nextId) ? [] : [nextId];
}

export function resolveConversationLabelId(ids: readonly string[]): string | undefined {
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const id = ids[i]?.trim();
    if (id) return id;
  }
  return undefined;
}
