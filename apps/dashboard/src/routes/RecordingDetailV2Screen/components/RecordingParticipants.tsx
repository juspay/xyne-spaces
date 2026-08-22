import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, Share2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useActiveUsers, useUsersById, useSelf, searchUsers } from '../../../hooks/useUsers';
import { recordingService } from '../../../services/Recording/recordingService';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { getRecordingParticipantIds, logRecordingError } from '../../../utils/recordingUtils';
import { getApiErrorMessage } from '../../../utils/apiError';
import Avatar from '../../../components/ui/Avatar/Avatar';
import AvatarGroup from '../../../components/ui/Avatar/AvatarGroup';
import { Popover } from '../../../components/ui/Popover/Popover';
import { Button } from '../../../components/ui/Button/Button';
import { cn } from '../../../utils/classNames';

interface RecordingParticipantsProps {
  recordingExternalId: string;
  createdByUserId: string | undefined;
}

export function RecordingParticipants({
  recordingExternalId,
  createdByUserId,
}: RecordingParticipantsProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlyMap<string, 'add' | 'remove'>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const users = useActiveUsers();
  const usersById = useUsersById();
  const self = useSelf();
  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recordingExternalId }),
  );

  const canManage = Boolean(self?.id && createdByUserId && self.id === createdByUserId);

  const serverIds = useMemo(
    () => getRecordingParticipantIds(createdByUserId, recordingRow?.recordingParticipants),
    [recordingRow, createdByUserId],
  );

  const participantIds = useMemo(() => {
    if (pending.size === 0) return serverIds;
    const ids = serverIds.filter(id => pending.get(id) !== 'remove');
    for (const [id, change] of pending) {
      if (change === 'add' && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [serverIds, pending]);

  useEffect(() => {
    setPending(current => {
      const next = new Map(current);
      for (const [id, change] of current) {
        if (serverIds.includes(id) === (change === 'add')) next.delete(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [serverIds]);

  const withAccess = useMemo(() => {
    const shared = new Set<string>();
    for (const share of recordingRow?.shares ?? []) {
      if (share.userId) shared.add(share.userId);
    }
    if (createdByUserId) shared.add(createdByUserId);
    return shared;
  }, [recordingRow, createdByUserId]);

  const accessKnown = !(recordingRow?.shares ?? []).some(
    share => Boolean(share.userGroupId) || Boolean(share.channelId),
  );

  const participants = useMemo(
    () => participantIds.map(id => usersById.get(id)).filter(Boolean),
    [participantIds, usersById],
  );

  const trimmedQuery = query.trim();
  const results = useMemo(() => {
    if (!trimmedQuery) return [];
    const already = new Set(participantIds);
    return searchUsers(
      users.filter(user => !already.has(user.id)),
      trimmedQuery,
      6,
    );
  }, [trimmedQuery, users, participantIds]);

  useEffect(() => setHighlighted(0), [trimmedQuery]);
  const activeIndex = highlighted < results.length ? highlighted : 0;

  const withBusy = async (userId: string, work: () => Promise<void>): Promise<void> => {
    setBusyIds(current => new Set(current).add(userId));
    try {
      await work();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(userId);
        return next;
      });
    }
  };

  const changeParticipant = (action: 'add' | 'remove', userId: string): void => {
    setPending(current => new Map(current).set(userId, action));
    void withBusy(userId, async () => {
      try {
        await recordingService.manageRecordingParticipant(recordingExternalId, action, userId);
      } catch (error) {
        setPending(current => {
          const next = new Map(current);
          next.delete(userId);
          return next;
        });
        logRecordingError('RecordingParticipants.change', error);
        toast.error(
          action === 'add' ? 'Could not add participant' : 'Could not remove participant',
          {
            description: getApiErrorMessage(error, 'Unable to update participants'),
          },
        );
      }
    });
  };

  const shareWith = (userId: string): void => {
    void withBusy(userId, async () => {
      try {
        await recordingService.grantRecordingAccess(recordingExternalId, [
          { type: 'user', id: userId },
        ]);
        toast.success('Recording shared');
      } catch (error) {
        logRecordingError('RecordingParticipants.share', error);
        toast.error('Could not share recording', {
          description: getApiErrorMessage(error, 'Unable to share this recording'),
        });
      }
    });
  };

  const total = participantIds.length;
  const withoutAccess = participantIds.filter(id => !withAccess.has(id)).length;

  if (total === 0) return null;

  const rowMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 4, filter: 'blur(4px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: {
          opacity: 0,
          y: -4,
          filter: 'blur(4px)',
          transition: { duration: 0.15, ease: 'easeIn' as const },
        },
        transition: { type: 'spring' as const, duration: 0.3, bounce: 0 },
      };

  const trigger = (
    <Button
      type='button'
      variant='outline'
      size='sm'
      className='h-7 gap-1.5 rounded-lg px-2 text-xs font-normal active:scale-[0.96]'
      aria-label={`Participants, ${total} added`}
      data-track-category='RecordingDetailV2'
      data-track-name='open_recording_participants'
    >
      <AvatarGroup userIds={participantIds.slice(0, 3)} size='xs' />
      <span className='tabular-nums'>{total}</span>
    </Button>
  );

  const emptyState = (
    <div className='flex flex-col items-center gap-1 px-4 py-7 text-center'>
      <Users className='size-4 text-muted-foreground' aria-hidden='true' />
      <p className='text-[13px] text-muted-foreground'>No one added yet</p>
      {canManage && (
        <p className='text-[11px] text-muted-foreground/70'>
          Search above to add the people this recording is about
        </p>
      )}
    </div>
  );

  return (
    <Popover
      trigger={trigger}
      side='bottom'
      align='start'
      sideOffset={6}
      focusRef={searchRef}
      className='w-[19rem] overflow-hidden p-0'
      onEscapeKeyDown={event => {
        if (!trimmedQuery) return;
        event.preventDefault();
        setQuery('');
      }}
    >
      <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2.5'>
        <span className='text-[13px] font-medium'>Participants</span>
        {recordingRow && total > 0 && accessKnown && (
          <span className='text-[11px] tabular-nums text-muted-foreground'>
            {withoutAccess === 0
              ? `all ${total} have access`
              : `${total - withoutAccess} of ${total} have access`}
          </span>
        )}
      </div>

      {canManage && (
        <div className='flex items-center gap-2 border-b border-border px-3'>
          <Search className='size-3.5 shrink-0 text-muted-foreground' aria-hidden='true' />
          <input
            ref={searchRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (results.length === 0) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlighted((activeIndex + 1) % results.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlighted((activeIndex - 1 + results.length) % results.length);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const picked = results[activeIndex];
                if (picked) {
                  setQuery('');
                  changeParticipant('add', picked.id);
                }
              }
            }}
            role='combobox'
            aria-expanded={results.length > 0}
            aria-controls='recording-participant-results'
            aria-activedescendant={results[activeIndex]?.id}
            placeholder='Add someone by name or email'
            className='h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground'
            data-track-category='RecordingDetailV2'
            data-track-name='search_recording_participants'
          />
        </div>
      )}

      {trimmedQuery ? (
        <div
          id='recording-participant-results'
          role='listbox'
          aria-label='Matching people'
          className='max-h-60 overflow-y-auto py-1'
        >
          {results.length === 0 && (
            <p className='px-3 py-5 text-center text-[13px] text-muted-foreground'>
              No one matches “{trimmedQuery}”
            </p>
          )}
          {results.map((user, index) => (
            <button
              key={user.id}
              id={user.id}
              role='option'
              aria-selected={index === activeIndex}
              type='button'
              disabled={busyIds.has(user.id)}
              onMouseMove={() => setHighlighted(index)}
              onClick={() => {
                setQuery('');
                changeParticipant('add', user.id);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left disabled:opacity-50',
                index === activeIndex && 'bg-muted',
              )}
              data-track-category='RecordingDetailV2'
              data-track-name='add_recording_participant'
            >
              <Avatar userId={user.id} size='rg' showActiveStatus={false} />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-[13px]'>{getUserDisplayName(user)}</span>
                <span className='block truncate text-[11px] text-muted-foreground'>
                  {user.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className='max-h-60 overflow-y-auto py-1'>
          {participants.length === 0 && emptyState}
          <AnimatePresence initial={false}>
            {participants.map(user => {
              if (!user) return null;
              const isSelf = user.id === self?.id;
              const busy = busyIds.has(user.id);
              const isOwner = user.id === createdByUserId;
              return (
                <motion.div
                  key={user.id}
                  layout={!reduceMotion}
                  {...rowMotion}
                  className='group flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50'
                >
                  <Avatar userId={user.id} size='rg' showActiveStatus={false} />
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5'>
                      <span className='truncate text-[13px]'>{getUserDisplayName(user)}</span>
                      {isSelf && !isOwner && (
                        <span className='shrink-0 text-[11px] text-muted-foreground'>You</span>
                      )}
                    </div>
                    <span className='block truncate text-[11px] text-muted-foreground'>
                      {isOwner ? 'Owner' : user.email}
                    </span>
                  </div>
                  {canManage && !isOwner && (
                    <div className='flex shrink-0 items-center gap-0.5'>
                      {accessKnown && !withAccess.has(user.id) && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          disabled={busy}
                          onClick={() => shareWith(user.id)}
                          className='h-7 gap-1 px-2 text-[11px] font-normal text-muted-foreground hover:text-foreground active:scale-[0.96]'
                          data-track-category='RecordingDetailV2'
                          data-track-name='share_with_recording_participant'
                        >
                          <Share2 className='size-3' aria-hidden='true' />
                          Share
                        </Button>
                      )}
                      <Button
                        type='button'
                        variant='ghost'
                        size='iconSm'
                        disabled={busy}
                        aria-label={`Remove ${getUserDisplayName(user)}`}
                        onClick={() => changeParticipant('remove', user.id)}
                        className='text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 active:scale-[0.96] group-hover:opacity-100'
                        data-track-category='RecordingDetailV2'
                        data-track-name='remove_recording_participant'
                      >
                        <X className='size-3.5' aria-hidden='true' />
                      </Button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </Popover>
  );
}
