import { useMemo, type ReactElement } from 'react';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';

interface RecordingSharedWithAvatarsProps {
  recordingExternalId: string;
  onOpen: () => void;
}

const MAX_VISIBLE_AVATARS = 3;

export const RecordingSharedWithAvatars = ({
  recordingExternalId,
  onOpen,
}: RecordingSharedWithAvatarsProps): ReactElement | null => {
  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recordingExternalId }),
  );

  const shares = useMemo(() => recordingRow?.shares ?? [], [recordingRow]);

  const userIds = useMemo(
    () =>
      shares
        .filter(share => !share.userGroupId && !share.channelId)
        .map(share => share.userId)
        .filter((userId): userId is string => Boolean(userId)),
    [shares],
  );

  const groupShareCount = shares.length - userIds.length;
  const visibleUserIds = userIds.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = userIds.length - visibleUserIds.length;

  const tooltipLabel = useMemo(() => {
    const people = `${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}`;
    if (groupShareCount === 0) return `Shared with ${people}`;
    const groups =
      groupShareCount === 1 ? '1 group or channel' : `${groupShareCount} groups and channels`;
    return `Shared with ${people}, ${groups}`;
  }, [groupShareCount, userIds.length]);

  // Nothing to show: either no shares at all, or only groups/channels which
  // don't have a face to put in the stack. The plain share button covers both.
  if (userIds.length === 0) return null;

  return (
    <Tooltip content={tooltipLabel} side='top'>
      <button
        type='button'
        onClick={onOpen}
        className='inline-flex h-7 items-center rounded-lg px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        aria-label={`${tooltipLabel}. Open share settings`}
        data-track-category='RecordingDetailV2'
        data-track-name='open_share_modal_from_avatars'
      >
        {visibleUserIds.map((userId, index) => (
          <Avatar
            key={userId}
            userId={userId}
            size='sm'
            rounded
            showActiveStatus={false}
            className={cn('size-6 font-semibold ring-2 ring-background', index > 0 && '-ml-2')}
          />
        ))}
        {overflowCount > 0 && (
          <span className='-ml-0.5 inline-flex size-6 shrink-0 items-center justify-center text-xs font-semibold text-muted-foreground ring-2 ring-background'>
            +{overflowCount}
          </span>
        )}
      </button>
    </Tooltip>
  );
};

export default RecordingSharedWithAvatars;
