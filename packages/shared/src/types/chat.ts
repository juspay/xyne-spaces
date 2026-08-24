export type HistoryScopeMode = 'none' | 'today' | 'beginning' | 'custom';

export type HistoryScope =
  | { mode: 'none' }
  | { mode: 'beginning' }
  | { mode: 'today'; from: string }
  | { mode: 'custom'; from: string };

export interface AddGroupDmParticipantsRequest {
  userIds: string[];
  historyScope?: HistoryScope;
  /** @deprecated use historyScope */
  includeHistory?: boolean;
}

export interface AddGroupDmParticipantsResponse {
  channelId: string;
  isExisting: boolean;
  participantsAdded: number;
  conversationsMoved?: number;
  message: string;
}

export interface HistoryPreviewAttachment {
  id: string;
  originalFilename: string;
}

export interface HistoryPreviewEntry {
  conversationId: string;
  createdAt: number;
  initialMessage: {
    senderId: string;
    content: string;
    senderName: string;
  } | null;
  attachments: HistoryPreviewAttachment[];
}

export interface HistoryPreviewResponse {
  conversations: HistoryPreviewEntry[];
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

export function historyScopeToCutoff(scope: HistoryScope): Date | null {
  if (scope.mode === 'beginning' || scope.mode === 'none') {
    return null;
  }
  const cutoff = new Date(scope.from);
  return Number.isNaN(cutoff.getTime()) ? null : cutoff;
}
