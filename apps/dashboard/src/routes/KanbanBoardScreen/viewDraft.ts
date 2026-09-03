import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';

const DRAFT_VERSION = 1;

export interface ViewDraft {
  filters: TicketFilters;
  groupBy: string;
  columns: string[];
}

interface StoredViewDraft extends ViewDraft {
  version: number;
}

const draftKey = (viewKey: string): string => `view-draft-${viewKey}`;

export const readViewDraft = (viewKey: string): ViewDraft | null => {
  try {
    const raw = sessionStorage.getItem(draftKey(viewKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredViewDraft>;
    if (parsed.version !== DRAFT_VERSION) return null;
    if (!parsed.filters || typeof parsed.filters !== 'object') return null;
    if (!Array.isArray(parsed.columns)) return null;
    return {
      filters: parsed.filters,
      groupBy: typeof parsed.groupBy === 'string' ? parsed.groupBy : 'none',
      columns: parsed.columns.filter((key): key is string => typeof key === 'string'),
    };
  } catch {
    return null;
  }
};

export const writeViewDraft = (viewKey: string, draft: ViewDraft): void => {
  try {
    const stored: StoredViewDraft = { version: DRAFT_VERSION, ...draft };
    sessionStorage.setItem(draftKey(viewKey), JSON.stringify(stored));
  } catch {
    /* storage unavailable — the edit still applies in-memory */
  }
};

export const clearViewDraft = (viewKey: string): void => {
  try {
    sessionStorage.removeItem(draftKey(viewKey));
  } catch {
    /* storage unavailable */
  }
};
