import { ReactElement, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Avatar from '../../components/ui/Avatar/Avatar';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { Popover } from '../../components/ui/Popover';
import { type CallParticipantRow } from '../../hooks/useCallParticipantRoster';
import { usePlatform } from '../../hooks/usePlatform';
import { cn } from '../../utils/classNames';
import { getCallParticipantCount, type Call } from '../CallHistoryScreen/callHistoryItem.utils';

/** Faces shown on the pill before it falls back to the bare count. */
const MAX_PARTICIPANT_FACES = 4;

interface CallParticipantsPopoverProps {
  call: Call;
  /** Resolved roster, owned by the screen — the timeline needs the same rows. */
  participants: CallParticipantRow[];
  isLoading: boolean;
  className?: string;
}

/**
 * The avatar-stack pill in the call header, and the roster it opens.
 *
 * Anchored to the pill rather than shown as a centred dialog — the roster is a
 * quick "who was on this call" glance, not a task worth blocking the page for.
 */
export function CallParticipantsPopover({
  call,
  participants,
  isLoading,
  className,
}: CallParticipantsPopoverProps): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const { isMobile } = usePlatform();

  // Attendees first, invitees after. `sort` is stable, so each group keeps the
  // roster order the hook produced.
  const orderedParticipants = useMemo(
    () => [...participants].sort((a, b) => Number(b.hasJoined) - Number(a.hasJoined)),
    [participants],
  );

  const participantCount = Math.max(getCallParticipantCount(call), participants.length);
  const faceUserIds = orderedParticipants
    .filter(participant => !participant.isExternal)
    .slice(0, MAX_PARTICIPANT_FACES)
    .map(participant => participant.userId);

  if (participantCount === 0) return null;

  const trigger = (
    <button
      aria-label={`${participantCount} participants`}
      data-track-category='CallDetail'
      data-track-name='open-participants-modal'
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border pl-[3px] pr-2.5 transition-colors',
        isOpen ? 'border-foreground/30 bg-accent' : 'border-border',
        !isMobile && 'hover:bg-accent',
      )}
    >
      {faceUserIds.length > 0 && <AvatarGroup userIds={faceUserIds} size='sm' />}
      <span className='text-[12.5px] font-medium text-muted-foreground'>{participantCount}</span>
    </button>
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Popover
        open={isOpen}
        onOpenChange={setIsOpen}
        side='bottom'
        align='start'
        sideOffset={6}
        collisionPadding={12}
        className='w-[322px] max-w-[calc(100vw-24px)] rounded-xl p-[7px] shadow-lg'
        trigger={trigger}
      >
        <div className='px-[9px] pb-1.5 pt-[5px] text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-foreground'>
          On this call
        </div>

        <div className='max-h-[320px] overflow-y-auto'>
          {orderedParticipants.map(participant => (
            <div
              key={participant.userId}
              className={cn(
                'flex items-center gap-2.5 rounded-[9px] px-[9px] py-1.5',
                !isMobile && 'hover:bg-muted',
              )}
            >
              <Avatar
                userId={participant.isExternal ? null : participant.userId}
                size='rg'
                rounded
                showActiveStatus={false}
              />
              <div className='min-w-0 flex-1'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='min-w-0 truncate text-[13px] font-medium text-foreground'>
                    {participant.name}
                    {participant.isCurrentUser && (
                      <span className='font-normal text-muted-foreground'> (you)</span>
                    )}
                  </span>
                  {participant.isExternal && <StatusPill tone='pending' label='External' />}
                </div>
                {participant.email && (
                  <span className='block truncate text-[11.5px] text-muted-foreground'>
                    {participant.email}
                  </span>
                )}
              </div>
              <StatusPill
                tone={participant.hasJoined ? 'success' : 'muted'}
                label={participant.hasJoined ? 'Joined' : 'Not joined'}
              />
            </div>
          ))}

          {isLoading && (
            <div className='flex items-center gap-2 px-[9px] py-2 text-[12px] text-muted-foreground'>
              <Loader2 className='size-3.5 animate-spin' />
              Loading participants...
            </div>
          )}
        </div>
      </Popover>
    </div>
  );
}

type PillTone = 'pending' | 'success' | 'muted';

// Semantic status tokens, not raw palette colours: `--status-*` is redefined per
// `[data-theme]`, so these follow the active theme. Tailwind's `dark:` variant
// cannot do that here — `darkMode` is `class`, and no `.dark` class is ever set.
const pillToneClasses: Record<PillTone, { pill: string; dot: string }> = {
  pending: {
    pill: 'border-status-pending/30 bg-status-pending/10 text-status-pending',
    dot: 'bg-status-pending',
  },
  success: {
    pill: 'border-status-success/30 bg-status-success/10 text-status-success',
    dot: 'bg-status-success',
  },
  muted: {
    pill: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
};

function StatusPill({ tone, label }: { tone: PillTone; label: string }): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border pl-[5px] pr-[7px] text-[10px] font-semibold tracking-[0.2px]',
        pillToneClasses[tone].pill,
      )}
    >
      <span className={cn('size-[5px] shrink-0 rounded-full', pillToneClasses[tone].dot)} />
      {label}
    </span>
  );
}
