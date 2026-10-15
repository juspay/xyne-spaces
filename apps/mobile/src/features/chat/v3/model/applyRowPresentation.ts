import type { ChatRow } from './chatRow.types';

export type RowPresentation = {
  expandedIds: ReadonlySet<string>;
  highlightedConversationId: string | null;
  enteringIds: ReadonlySet<string>;
  reminderByMessageId: ReadonlyMap<string, string>;
};

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_REMINDERS: ReadonlyMap<string, string> = new Map();

export const EMPTY_PRESENTATION: RowPresentation = {
  expandedIds: EMPTY_IDS,
  highlightedConversationId: null,
  enteringIds: EMPTY_IDS,
  reminderByMessageId: EMPTY_REMINDERS,
};

const needsClone = (
  row: Extract<ChatRow, { type: 'message' }>,
  isExpanded: boolean,
  isHighlighted: boolean,
  isEntering: boolean,
  reminderLabel: string | null,
): boolean =>
  row.model.isExpanded !== isExpanded ||
  row.model.isHighlighted !== isHighlighted ||
  row.model.isEntering !== isEntering ||
  row.model.reminderLabel !== reminderLabel;

/**
 * Clones only message rows whose presentation flags change.
 * Presentation lives on the item so `itemsAreEqual` / `getFixedItemSize`
 * see it — never `extraData` (C15).
 */
export const applyRowPresentation = (
  rows: readonly ChatRow[],
  presentation: Partial<RowPresentation> = {},
): readonly ChatRow[] => {
  const expandedIds = presentation.expandedIds ?? EMPTY_IDS;
  const highlightedConversationId = presentation.highlightedConversationId ?? null;
  const enteringIds = presentation.enteringIds ?? EMPTY_IDS;
  const reminderByMessageId = presentation.reminderByMessageId ?? EMPTY_REMINDERS;
  let changed = false;
  const next = rows.map(row => {
    if (row.type !== 'message') {
      return row;
    }
    const isExpanded = expandedIds.has(row.model.conversationId);
    const isHighlighted =
      highlightedConversationId !== null &&
      (row.model.conversationId === highlightedConversationId ||
        row.model.messageId === highlightedConversationId);
    const isEntering = enteringIds.has(row.model.conversationId);
    const reminderLabel = row.model.messageId
      ? (reminderByMessageId.get(row.model.messageId) ?? null)
      : null;
    if (!needsClone(row, isExpanded, isHighlighted, isEntering, reminderLabel)) {
      return row;
    }
    changed = true;
    return {
      ...row,
      model: {
        ...row.model,
        isExpanded,
        isHighlighted,
        isEntering,
        reminderLabel,
      },
    };
  });
  return changed ? next : rows;
};
