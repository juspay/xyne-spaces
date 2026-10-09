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
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Observable } from '@legendapp/state';

import type { DmListItemData, DmListParticipantIdentity } from '@/src/types/dm-list-item';
import { Avatar } from '@/src/ui';
import { haptics } from '@/src/utils/haptics';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';

import { DM_AVATAR_SIZE, DM_ROW_HEIGHT } from '../constants';
import { StarIcon } from '../icons';
import { formatDmTimestamp } from '../model/timestamp';
import { todayStart$ } from '../state/day-clock';
import { dmRow$ } from '../state/rows-store';
import { cn } from '@/src/utils/cn';

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
      className={cn(
        'text-[16px] font-medium text-spaces-foreground',
        unreadCount && unreadCount > 0 && 'font-semibold',
      )}
    >
      {title ?? ''}
    </Text>
  );
}

function Preview(): ReactElement {
  const row$ = useRowNode();
  const text = useValue(() => row$.lastMessage.text.get());
  return (
    <Text numberOfLines={1} className='text-[14px] text-spaces-muted'>
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
  const todayStart = useValue(todayStart$);

  return (
    <Text className='text-[13px] text-spaces-muted'>
      {formatDmTimestamp(activityAt ?? 0, todayStart)}
    </Text>
  );
}

/** Sits beside the unread badge, so a starred conversation reads at a glance. */
function Starred(): ReactElement | null {
  const row$ = useRowNode();
  const isStarred = useValue(() => row$.isStarred.get());
  if (isStarred !== true) return null;
  return <StarIcon width={16} height={16} />;
}

function UnreadBadge(): ReactElement | null {
  const row$ = useRowNode();
  const count = useValue(() => row$.unreadCount.get());
  if (!count) return null;
  return (
    <View className='min-w-[22px] h-[22px] px-1.5 rounded-full bg-spaces-accent items-center justify-center'>
      <Text className='text-[12px] font-semibold text-spaces-accent-foreground'>{count}</Text>
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
    openBaseChatRoute(router, id, {
      surface: 'dms',
      unreadCount: row?.unreadCount,
      unreadLastViewedAt: row?.lastViewedAt,
      unreadLastViewedConversationId: row?.lastViewedConversationId,
    });
  }, [id, onSelect, row$, router]);

  return (
    <DmRowContext.Provider value={row$}>
      <Pressable onPress={handlePress} style={{ height: DM_ROW_HEIGHT }}>
        {children}
      </Pressable>
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
