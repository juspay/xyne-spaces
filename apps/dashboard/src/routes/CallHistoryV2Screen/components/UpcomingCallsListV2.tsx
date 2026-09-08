import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, CalendarDefault } from '@xyne/icons';
import { CallStatus } from '@xyne/shared';
import { isSameDay } from '../../../utils/dateUtils';
import { type Call } from '../../CallHistoryScreen/callHistoryItem.utils';
import { useUsers } from '../../../hooks/useUsers';
import { UpcomingCallRowV2 } from './UpcomingCallRowV2';

/** Rows always visible before the "View N more" toggle appears. */
const COLLAPSED_COUNT = 3;
const COLLAPSE_TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.2, 1] as const };

function isActiveCall(call: Call): boolean {
  return call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS;
}

/** Empty-state greeting varies with how much of the day is still ahead. */
function getEmptyStateTitle(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Nothing on the horizon tonight';
  if (hour < 12) return 'Nothing on the books this morning';
  if (hour < 17) return 'Clear for the rest of the day';
  if (hour < 21) return 'Winding down for the day';
  return 'All quiet tonight';
}

export interface UpcomingCallsListV2Props {
  calls: Call[];
  onJoinCall: (call: Call) => void;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
  currentUserId?: string | undefined;
  /** Defaults to today. */
  day?: Date | undefined;
}

/** V2's flat, single-day Upcoming widget — always references the shared `UpcomingCallsList` for data/behavior parity, but renders its own row layout (time-inline, no day column). */
export function UpcomingCallsListV2({
  calls,
  onJoinCall,
  onEditCall,
  onCancelCall,
  currentUserId,
  day,
}: UpcomingCallsListV2Props): React.JSX.Element {
  const allUsers = useUsers();

  const targetDay = day ?? new Date();
  const todaysCalls = useMemo(() => {
    const relevant = calls.filter(
      call =>
        isActiveCall(call) || (call.startsAt && isSameDay(new Date(call.startsAt), targetDay)),
    );
    // Active calls pinned to the top; everything else keeps its startsAt-ascending order.
    return [...relevant].sort((a, b) => Number(isActiveCall(b)) - Number(isActiveCall(a)));
  }, [calls, targetDay]);

  const [isExpanded, setIsExpanded] = useState(false);
  const isEmpty = todaysCalls.length === 0;
  const visibleCalls = todaysCalls.slice(0, COLLAPSED_COUNT);
  const extraCalls = todaysCalls.slice(COLLAPSED_COUNT);

  return (
    <AnimatePresence mode='wait' initial={false}>
      {isEmpty ? (
        <motion.div
          key='empty'
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={COLLAPSE_TRANSITION}
          className='flex flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 py-8 text-center'
        >
          <span className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
            <CalendarDefault className='size-5' strokeWidth={2} />
          </span>
          <div className='flex flex-col gap-1'>
            <p className='text-sm font-semibold text-foreground'>{getEmptyStateTitle(targetDay)}</p>
            <p className='max-w-sm text-xs text-muted-foreground'>
              Calls you schedule, and calls started in channels you&apos;re in, land here with a
              Join button when it&apos;s time.
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key='list'
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={COLLAPSE_TRANSITION}
          className='border border-border rounded-xl overflow-hidden'
        >
          <div className='divide-y divide-border'>
            {visibleCalls.map(call => (
              <UpcomingCallRowV2
                key={call.id}
                call={call}
                allUsers={allUsers}
                currentUserId={currentUserId}
                onJoinCall={onJoinCall}
                onEditCall={onEditCall}
                onCancelCall={onCancelCall}
              />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {isExpanded && extraCalls.length > 0 && (
              <motion.div
                key='extra-rows'
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={COLLAPSE_TRANSITION}
                className='overflow-hidden border-t border-border'
              >
                <div className='divide-y divide-border'>
                  {extraCalls.map(call => (
                    <UpcomingCallRowV2
                      key={call.id}
                      call={call}
                      allUsers={allUsers}
                      currentUserId={currentUserId}
                      onJoinCall={onJoinCall}
                      onEditCall={onEditCall}
                      onCancelCall={onCancelCall}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {extraCalls.length > 0 && (
            <button
              type='button'
              onClick={() => setIsExpanded(prev => !prev)}
              data-track-category='CALLS'
              data-track-name='upcoming-toggle-expand'
              className='flex w-full items-center justify-center gap-1 border-t border-border bg-muted/40 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted'
            >
              {isExpanded ? 'View less' : `View ${extraCalls.length} more`}
              <motion.span
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className='flex items-center'
              >
                <ChevronDown className='size-3.5' />
              </motion.span>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
