export type HistoryScopeMode = 'none' | 'today' | 'beginning' | 'custom';

export type HistoryScope =
  | { mode: 'none' }
  | { mode: 'today' }
  | { mode: 'beginning' }
  | { mode: 'custom'; from: string };

export interface AddGroupDmParticipantsRequest {
  userIds: string[];
  historyScope?: HistoryScope;
  includeAttachments?: boolean;
  /** @deprecated use historyScope */
  includeHistory?: boolean;
}

export interface AddGroupDmParticipantsResponse {
  channelId: string;
  isExisting: boolean;
  participantsAdded: number;
  conversationsCopied?: number;
  message: string;
}

export const MAX_DM_PARTICIPANTS = 10;

export function normalizeHistoryScope(input: {
  historyScope?: HistoryScope;
  includeHistory?: boolean;
}): HistoryScope {
  if (input.historyScope) {
    return input.historyScope;
  }
  if (input.includeHistory === true) {
    return { mode: 'beginning' };
  }
  return { mode: 'none' };
}

export function scopeCarriesHistory(scope: HistoryScope): boolean {
  return scope.mode !== 'none';
}

export const ATTACHMENT_WITHHELD_TEXT = '[file not shared]';

export function normalizeIncludeAttachments(input: { includeAttachments?: boolean }): boolean {
  return input.includeAttachments ?? true;
}

export function historyScopeToCutoff(scope: HistoryScope, now: Date): Date | null {
  switch (scope.mode) {
    case 'beginning':
      return null;
    case 'today': {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      return startOfDay;
    }
    case 'custom':
      return new Date(scope.from);
    case 'none':
      return null;
  }
}
