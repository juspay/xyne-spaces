import { useValue } from '@legendapp/state/react';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Observable } from '@legendapp/state';

import type { DmListItemData, DmListParticipantIdentity } from '@/src/types/dm-list-item';
import { Avatar } from '@/src/ui';
import { haptics } from '@/src/utils/haptics';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { ContextMenu } from '@/src/ui/context-menu';

import { DmRowMenu } from './dm-row-menu';

import {
  DM_AVATAR_SIZE,
  DM_BADGE_PADDING_X,
  DM_BADGE_SIZE,
  DM_BADGE_TEXT_SIZE,
  DM_PREVIEW_LINE_HEIGHT,
  DM_PREVIEW_LINES,
  DM_PREVIEW_SIZE,
  DM_ROW_HEIGHT,
  DM_STAR_SIZE,
  DM_TIMESTAMP_LINE_HEIGHT,
  DM_TIMESTAMP_SIZE,
  DM_TITLE_LINE_HEIGHT,
  DM_TITLE_SIZE,
} from '../constants';
import { StarIcon } from '../icons';
import { formatDmTimestamp } from '../model/timestamp';
import { todayStart$ } from '../state/day-clock';
import { dmRow$ } from '../state/rows-store';
import { cn } from '@/src/utils/cn';
import { logUnreadDiagRowPress } from '@/src/utils/unreadDiagnostics';

/**
 * Module-level, so a row that is mid-teardown or still hydrating hands the
 * avatar the same empty array every render instead of a fresh one.
 */
const NO_USER_IDS: readonly string[] = [];
const NO_FALLBACK_USERS: readonly DmListParticipantIdentity[] = [];

const DmRowContext = createContext<Observable<DmListItemData> | null>(null);

/**
 * The row's node. Slots read leaves off it; nothing reads the whole thing.
 *
 * A slot that called `.get()` on the row node would re-render on any change to
 * any field, which is the behaviour this file exists to avoid.
 */
function useRowNode(): Observable<DmListItemData> {
  const node = useContext(DmRowContext);
  if (node === null) throw new Error('DmRow slot used outside <DmRow>');
  return node;
}

/**
 * The avatar, subscribed to the two fields that draw it and nothing else.
 *
 * This is the slot with real work behind it — identity lookups, a cached
 * image, possibly two of each. Keeping it off `title`, `lastMessage` and
 * `unreadCount` means a conversation receiving messages all day never
 * re-renders its own picture.
 */
function AvatarSlot(): ReactElement {
  const row$ = useRowNode();
  const userIds = useValue(() => row$.participantUserIds.get());
  /*
   * Legend State types an optional array node's elements as possibly
   * `undefined`, which `noUncheckedIndexedAccess` then keeps. The array that
   * comes back is the one `reconcileDmRow` built and every entry in it is
   * present, so the cast narrows a typing artifact rather than a real case.
   */
  const identities = useValue(() => row$.participantIdentities.get()) as
    readonly DmListParticipantIdentity[] | undefined;

  return (
    <Avatar
      userIds={userIds ?? NO_USER_IDS}
      fallbackUsers={identities ?? NO_FALLBACK_USERS}
      // `participantUserIds` leaves the current user out, so the group bubble
      // would read one short of the conversation's head count.
      memberCount={(userIds?.length ?? 0) + 1}
      size={DM_AVATAR_SIZE}
    />
  );
}

function Title(): ReactElement {
  const row$ = useRowNode();
  const title = useValue(() => row$.title.get());
  const unreadCount = useValue(() => row$.unreadCount.get());

  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: DM_TITLE_SIZE, lineHeight: DM_TITLE_LINE_HEIGHT }}
      className={cn(
        'font-semibold text-spaces-foreground',
        unreadCount && unreadCount > 0 && 'font-bold',
      )}
    >
      {title ?? ''}
    </Text>
  );
}

/** One line, clipped. */
function Preview(): ReactElement {
  const row$ = useRowNode();
  const text = useValue(() => row$.lastMessage.text.get());
  return (
    <Text
      numberOfLines={DM_PREVIEW_LINES}
      ellipsizeMode='tail'
      style={{ fontSize: DM_PREVIEW_SIZE, lineHeight: DM_PREVIEW_LINE_HEIGHT }}
      className='text-spaces-muted'
    >
      {text ?? ''}
    </Text>
  );
}

/**
 * Subscribed to the raw time and to which day it is, not to a prepared label.
 *
 * `timestampLabel` on the row is the shared formatter's output, which buckets
 * by elapsed milliseconds rather than calendar days — see `model/timestamp`.
 * Formatting here from `lastActivityAtMs` keeps the classic list on the
 * formatter it already has while this one reads correctly across midnight.
 */
function Timestamp(): ReactElement {
  const row$ = useRowNode();
  const activityAt = useValue(() => row$.lastActivityAtMs.get());
  const unreadCount = useValue(() => row$.unreadCount.get());
  const todayStart = useValue(todayStart$);

  /*
   * Unread turns the time into a second badge.
   */
  const isUnread = (unreadCount ?? 0) > 0;

  return (
    <Text
      style={{ fontSize: DM_TIMESTAMP_SIZE, lineHeight: DM_TIMESTAMP_LINE_HEIGHT }}
      className={cn(isUnread ? 'font-semibold text-spaces-accent' : 'text-spaces-muted')}
    >
      {formatDmTimestamp(activityAt ?? 0, todayStart)}
    </Text>
  );
}

/** Sits beside the unread badge, so a starred conversation reads at a glance. */
function Starred(): ReactElement | null {
  const row$ = useRowNode();
  const isStarred = useValue(() => row$.isStarred.get());
  if (isStarred !== true) return null;
  return <StarIcon width={DM_STAR_SIZE} height={DM_STAR_SIZE} />;
}

function UnreadBadge(): ReactElement | null {
  const row$ = useRowNode();
  const count = useValue(() => row$.unreadCount.get());
  if (!count) return null;
  return (
    <View
      className='rounded-full bg-spaces-accent items-center justify-center'
      style={{
        minWidth: DM_BADGE_SIZE,
        height: DM_BADGE_SIZE,
        paddingHorizontal: DM_BADGE_PADDING_X,
      }}
    >
      <Text
        style={{ fontSize: DM_BADGE_TEXT_SIZE }}
        className='font-semibold text-spaces-accent-foreground'
      >
        {count}
      </Text>
    </View>
  );
}

type DmRowProps = {
  id: string;
  children: ReactNode;
  onSelect?: ((channelId: string) => void) | undefined;
};

/**
 * Subscribes to nothing.
 *
 * It renders once when the list hands it an id — including when the list
 * recycles it onto a different conversation — and then never again on data
 * change. Every subsequent update lands on whichever slot owns that field.
 *
 * The press handler `peek()`s instead of reading, so opening a chat does not
 * make the row depend on the values it passes along.
 */
function DmRowComponent({ id, children, onSelect }: DmRowProps): ReactElement {
  const router = useRouter();
  const row$ = useMemo(() => dmRow$(id), [id]);

  const handlePress = useCallback(() => {
    void haptics.buttonTap();
    if (onSelect) {
      onSelect(id);
      return;
    }
    const row = row$.peek();
    logUnreadDiagRowPress('dm_row', id, row);
    openBaseChatRoute(router, id, {
      surface: 'dms',
      unreadCount: row?.unreadCount,
      unreadLastViewedAt: row?.lastViewedAt,
      unreadLastActivityAt: row?.lastActivityAtMs,
      unreadLastViewedConversationId: row?.lastViewedConversationId,
    });
  }, [id, onSelect, row$, router]);

  /*
   * `ContextMenu.Trigger` replaces the row's own `Pressable` rather than
   * wrapping it — two nested pressables would compete for the same gesture.
   *
   * Closed, the `Root` is a `useState` and a context object. The card, its
   * backdrop and the actions all mount on the long press.
   */
  return (
    <DmRowContext.Provider value={row$}>
      <ContextMenu.Root>
        <ContextMenu.Trigger onPress={handlePress} style={{ height: DM_ROW_HEIGHT }}>
          {children}
        </ContextMenu.Trigger>
        <DmRowMenu id={id} />
      </ContextMenu.Root>
    </DmRowContext.Provider>
  );
}

export const DmRow = Object.assign(memo(DmRowComponent), {
  Avatar: AvatarSlot,
  Title,
  Preview,
  Timestamp,
  Starred,
  UnreadBadge,
});
