type TicketIdSources = {
  ticketId: string;
  fallbackTicketId?: string | null | undefined;
  fallbackConversationTicketId?: string | null | undefined;
  fallbackTicketMdId?: string | null | undefined;
};

/** Route ticket id wins; conversation cache is only a hydrate fallback. */
export function resolveEffectiveTicketId(sources: TicketIdSources): string {
  return (
    sources.ticketId ||
    sources.fallbackTicketId ||
    sources.fallbackConversationTicketId ||
    sources.fallbackTicketMdId ||
    ''
  );
}

type IdChain = ReadonlyArray<string | null | undefined>;

export function firstNonEmptyId(...candidates: IdChain): string {
  for (const candidate of candidates) {
    const value = (candidate ?? '').trim();
    if (value) return value;
  }
  return '';
}
