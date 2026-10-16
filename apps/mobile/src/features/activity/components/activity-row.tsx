import { useValue } from '@legendapp/state/react';
import type { Observable } from '@legendapp/state';
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

import { formatDmTimestamp } from '@/src/features/dms/model/timestamp';
import { todayStart$ } from '@/src/features/dms/state/day-clock';
import { useZero } from '@/src/hooks/useZero';
import { Avatar } from '@/src/ui';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { mutators } from '@/src/zero/mutators';

import {
  ACTIVITY_ACTOR_LINE_HEIGHT,
  ACTIVITY_ACTOR_SIZE,
  ACTIVITY_AVATAR_SIZE,
  ACTIVITY_BADGE_OFFSET,
  ACTIVITY_BODY_GAP,
  ACTIVITY_BODY_LINE_HEIGHT,
  ACTIVITY_BODY_SIZE,
  ACTIVITY_CHIP_SIZE,
  ACTIVITY_ROW_PADDING_X,
  ACTIVITY_ROW_PADDING_Y,
  ACTIVITY_SUMMARY_LINE_HEIGHT,
  ACTIVITY_SUMMARY_SIZE,
  ACTIVITY_TIME_SIZE,
} from '../constants';
import type { ActivityRowData } from '../model/row';
import { openActivityTarget } from '../presentation/openActivityTarget';
import { activityRow$ } from '../state/rows-store';
import { appliedActivityPreferences$ } from '../state/preferences-store';
import { ActivityAttachments, ActivityMessageBody } from './activity-body';
import { ActivityBadge } from './activity-badge';

/**
 * Module-level, so a row mid-teardown hands the avatar the same empty array
 * every render instead of a fresh one.
 */
const NO_USER_IDS: readonly string[] = [];

const ActivityRowContext = createContext<Observable<ActivityRowData> | null>(null);

/**
 * The row's node. Slots read leaves off it; nothing reads the whole row.
 *
 * A slot that called `.get()` on the node would re-render on any field
 * changing, which is the behaviour this file exists to avoid.
 */
function useRowNode(): Observable<ActivityRowData> {
  const node = useContext(ActivityRowContext);
  if (node === null) throw new Error('ActivityRow slot used outside <ActivityRow>');
  return node;
}

/** The person, with the action badge hanging off its corner. */
function Leading(): ReactElement {
  const row$ = useRowNode();
  const actorId = useValue(() => row$.actorId.get());
  const userIds = useMemo(() => (actorId ? [actorId] : NO_USER_IDS), [actorId]);
  const badge = useValue(() => row$.badge.get());
  const reactionEmoji = useValue(() => row$.reactionEmoji.get());

  return (
    <View style={{ width: ACTIVITY_AVATAR_SIZE, height: ACTIVITY_AVATAR_SIZE }}>
      <Avatar userIds={userIds} size={ACTIVITY_AVATAR_SIZE} />
      <View
        style={{
          position: 'absolute',
          right: ACTIVITY_BADGE_OFFSET,
          bottom: ACTIVITY_BADGE_OFFSET,
        }}
      >
        <ActivityBadge kind={badge ?? 'default'} reactionEmoji={reactionEmoji ?? null} />
      </View>
    </View>
  );
}

function Actor(): ReactElement {
  const row$ = useRowNode();
  const name = useValue(() => row$.actorName.get());
  const isUnread = useValue(() => row$.isUnread.get());

  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: ACTIVITY_ACTOR_SIZE, lineHeight: ACTIVITY_ACTOR_LINE_HEIGHT }}
      className={cn('flex-1 text-spaces-foreground', isUnread ? 'font-semibold' : 'font-medium')}
    >
      {name ?? ''}
    </Text>
  );
}

/**
 * Subscribed to the raw time and to which day it is, not to a prepared label —
 * the same reason the DMs and Channels rows are: a label formatted at sync time
 * is wrong after midnight.
 */
function Time(): ReactElement {
  const row$ = useRowNode();
  const timeMs = useValue(() => row$.timeMs.get());
  const todayStart = useValue(todayStart$);

  return (
    <Text style={{ fontSize: ACTIVITY_TIME_SIZE }} className='text-spaces-muted'>
      {formatDmTimestamp(timeMs ?? 0, todayStart)}
    </Text>
  );
}

/** "mentioned  #payments-core" — a verb and, when there is one, its pill. */
function Summary(): ReactElement {
  const row$ = useRowNode();
  const isUnread = useValue(() => row$.isUnread.get());
  const verb = useValue(() => row$.verb.get());
  const subject = useValue(() => row$.subject.get());
  const label =
    subject === null || subject === undefined
      ? null
      : subject.kind === 'channel'
        ? `#${subject.label}`
        : subject.label;

  return (
    <View
      className='flex-row items-center gap-1.5'
      style={{ height: ACTIVITY_SUMMARY_LINE_HEIGHT }}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: ACTIVITY_SUMMARY_SIZE }}
        className='shrink text-spaces-muted'
      >
        {verb ?? ''}
      </Text>
      {label !== null ? (
        <View
          className={cn(
            'shrink rounded-md px-1.5',
            isUnread ? 'bg-spaces-accent/14' : 'bg-spaces-surface',
          )}
        >
          <Text
            numberOfLines={1}
            style={{ fontSize: ACTIVITY_CHIP_SIZE, lineHeight: ACTIVITY_SUMMARY_LINE_HEIGHT - 4 }}
            className='text-spaces-muted'
          >
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A message as rich text and attachments, a composed sentence as plain text, or nothing. */
function Body(): ReactElement | null {
  const row$ = useRowNode();
  const body = useValue(() => row$.body.get());
  // Condensed leaves attachments out; the row's text is the same either way.
  const showsAttachments = useValue(appliedActivityPreferences$.viewMode) === 'detailed';
  if (body === undefined || body.kind === 'none') return null;

  return (
    <View style={{ marginTop: ACTIVITY_BODY_GAP }}>
      {body.kind === 'message' ? (
        <>
          <ActivityMessageBody content={body.content} senderId={body.senderId} />
          {showsAttachments ? (
            <ActivityAttachments
              attachments={body.attachments}
              conversationId={body.conversationId}
            />
          ) : null}
        </>
      ) : (
        <Text
          numberOfLines={2}
          ellipsizeMode='tail'
          style={{ fontSize: ACTIVITY_BODY_SIZE, lineHeight: ACTIVITY_BODY_LINE_HEIGHT }}
          className='text-spaces-foreground'
        >
          {body.text}
        </Text>
      )}
    </View>
  );
}

/**
 * The tappable surface. The only slot that knows about the tint, so a row
 * being marked read repaints its background and re-renders none of its content.
 */
function Surface({
  onPress,
  children,
}: {
  onPress: () => void;
  children: ReactNode;
}): ReactElement {
  const row$ = useRowNode();
  const isUnread = useValue(() => row$.isUnread.get());

  return (
    <Pressable
      accessibilityRole='button'
      onPress={onPress}
      className={cn(
        'flex-row border-spaces-muted/15',
        // Pressing deepens the row's own background, so the tap is shown as a
        // surface being pressed rather than as the content fading.
        isUnread
          ? 'bg-spaces-accent/8 active:bg-spaces-accent/18'
          : 'bg-spaces-background active:bg-spaces-surface',
      )}
      style={{
        paddingHorizontal: ACTIVITY_ROW_PADDING_X,
        paddingVertical: ACTIVITY_ROW_PADDING_Y,
        borderBottomWidth: 1,
      }}
    >
      {children}
    </Pressable>
  );
}

type ActivityRowProps = {
  id: string;
  children: ReactNode;
};

/**
 * Subscribes to nothing.
 *
 * It renders when the list hands it an id — including when the list recycles
 * it onto a different activity — and never again on data change. Updates land
 * on whichever slot owns the field. The press handler `peek()`s, so opening an
 * activity does not make the row depend on what it passes along.
 *
 * The press does what the classic card does: marks the activity read, then
 * navigates.
 */
function ActivityRowComponent({ id, children }: ActivityRowProps): ReactElement {
  const zero = useZero();
  const row$ = useMemo(() => activityRow$(id), [id]);

  const handlePress = useCallback(() => {
    const row = row$.peek();
    if (row === undefined) return;

    void haptics.buttonTap();
    if (row.isUnread) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: id }));
    }
    openActivityTarget(row.target);
  }, [id, row$, zero]);

  return (
    <ActivityRowContext.Provider value={row$}>
      <Surface onPress={handlePress}>{children}</Surface>
    </ActivityRowContext.Provider>
  );
}

export const ActivityRow = Object.assign(memo(ActivityRowComponent), {
  Leading,
  Actor,
  Time,
  Summary,
  Body,
});
