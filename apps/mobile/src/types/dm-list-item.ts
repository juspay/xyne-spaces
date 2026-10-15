import { ChannelScopeType } from '@xyne/shared';

export type LastMessagePreview =
  | {
      variant: 'text';
      text: string;
      /** Set when the preview is intentionally emoji-only (slightly larger text if you want later). */
      isEmojiOnly?: boolean;
    }
  | {
      variant: 'system';
      text: string;
    }
  | {
      variant: 'attachment';
      attachmentKind: 'photo' | 'document' | 'video' | 'file' | 'other';
      /** e.g. "Photo", filename, or combined short label */
      text?: string;
      thumbnailUri?: string;
    };

export type DmListParticipantIdentity = {
  id: string;
  name?: string;
  displayName?: string;
  picture?: string | null;
};

export type DmIdentitySnapshot = Record<
  string,
  {
    id: string;
    name: string;
    picture?: string | null;
  }
>;

export interface DmListItemData {
  id: string;
  title: string;
  /** Passed to `<Avatar userIds={...} />` — 1 for DM, first 2 shown for group. */
  participantUserIds: readonly string[];
  /** First-paint fallback while global users hydrate on cold start. */
  participantIdentities?: readonly DmListParticipantIdentity[];
  scopeType: ChannelScopeType.DM | ChannelScopeType.GROUP_DM;
  lastMessage: LastMessagePreview;
  timestampLabel: string;
  unreadCount?: number;
  lastViewedAt?: number;
  lastViewedConversationId?: string;
  isLastMessageOutgoing?: boolean;
  isStarred?: boolean;
  statusEmoji?: string;
  /** Used for starred-first + recency sorting; not shown in UI. */
  lastActivityAtMs?: number;
}
