import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addDays,
  endOfWeek,
  isSameWeek,
  isWithinInterval,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { CallStatus } from '@xyne/shared';
import { ChevronLeft, ChevronRight } from '@xyne/icons';
import { Button } from '../ui/Button';
import { DatePicker } from '../ui/DatePicker/DatePicker';
import { xyneCalendarActor } from '../../machines/xyneCalendarMachine';
import { useAuth } from '../../hooks/useAuth';
import { useAllChannels } from '../../hooks/useChannels';
import { useUsersById } from '../../hooks/useUsers';
import { useCallHistory } from '../../routes/CallHistoryScreen/useCallHistory';
import CalendarWeekView from '../../routes/CallHistoryScreen/CalendarWeekView';
import { ScheduleCallModal } from '../Call/ScheduleCallModal/ScheduleCallModal';
import { DeleteCallModal } from '../Call/DeleteCallModal';
import { dateToIso, isoToDate, formatWeekRangeLabel } from '../../utils/dateUtils';
import {
  getNearPeriodPhrase,
  getPeriodCallCountLabel,
  getXyneCalendarChannelPresentation,
} from '../Chat/XyneCalendarSidebar/xyneCalendarSidebar.utils';
import type { Call } from '../../routes/CallHistoryScreen/callHistoryItem.utils';

/**
 * Renders a call activity's week directly in the Activity center pane, as a real
 * route (`/chat/activity/calendar?callId=&date=`) instead of the shared Calendar
 * sidebar — so it survives a hard reload via the URL alone, with no sidebar/XState
 * involvement.
 */
export const ActivityCalendarWeekView = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const callId = searchParams.get('callId');
  const dateParam = searchParams.get('date');
  const currentWeekStart = useMemo(
    () => (dateParam ? isoToDate(dateParam) : new Date()),
    [dateParam],
  );

  // Avoid showing two calendar surfaces at once
  useEffect(() => {
    xyneCalendarActor.send({ type: 'CLOSE' });
  }, []);

  const { user } = useAuth();
  const {
    calls,
    calendarScheduledCalls,
    isLoading,
    isScheduledCallsLoading,
    handleCallRowClick,
    handleGotoTranscript,
    handleDownloadTranscript,
    handleEditClick,
    editModalOpen,
    editModalCall,
    closeEditModal,
    handleDeleteClick,
    deleteModalOpen,
    deleteModalCall,
    handleDeleteConfirm,
    closeDeleteModal,
  } = useCallHistory(user?.id);

  // Week view isn't day-scoped, so it needs calls + scheduled calls merged, deduped by id.
  const allCalls = useMemo(() => {
    const callsById = new Map<string, Call>();
    for (const call of [...(calls ?? []), ...(calendarScheduledCalls ?? [])]) {
      callsById.set(call.id, call);
    }
    return Array.from(callsById.values());
  }, [calls, calendarScheduledCalls]);

  const channels = useAllChannels();
  const usersById = useUsersById();
  const channelPresentationsById = useMemo(
    () =>
      new Map(
        channels.map(channel => [
          channel.id,
          getXyneCalendarChannelPresentation(channel, user?.id ?? '', usersById),
        ]),
      ),
    [channels, user?.id, usersById],
  );

  const [scheduleInitialTime, setScheduleInitialTime] = useState<{
    startsAt: Date;
    endsAt: Date;
  } | null>(null);
  const handleCreateCallAtSlot = useCallback(
    (startsAt: Date, endsAt: Date): void => setScheduleInitialTime({ startsAt, endsAt }),
    [],
  );

  const goToWeek = useCallback(
    (weekStart: Date): void => {
      const next = new URLSearchParams(searchParams);
      next.set('date', dateToIso(weekStart));
      next.delete('callId');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const weekCalls = useMemo(() => {
    const rangeStart = startOfWeek(currentWeekStart, { weekStartsOn: 0 });
    const rangeEnd = endOfWeek(currentWeekStart, { weekStartsOn: 0 });
    return allCalls.filter(
      call =>
        call.startsAt &&
        isWithinInterval(new Date(call.startsAt), { start: rangeStart, end: rangeEnd }),
    );
  }, [allCalls, currentWeekStart]);

  const callCountLabel = getPeriodCallCountLabel(
    {
      callCount: weekCalls.length,
      liveCount: weekCalls.filter(call => call.status === CallStatus.ACTIVE).length,
      scheduledCount: weekCalls.filter(call => call.status === CallStatus.SCHEDULED).length,
      endedCount: weekCalls.filter(call => call.status === CallStatus.ENDED).length,
    },
    getNearPeriodPhrase('week', currentWeekStart, new Date()),
    isLoading || isScheduledCallsLoading,
  );

  return (
    <div className='flex h-full w-full flex-col items-center'>
      <div className='flex h-full w-full flex-col'>
        <header className='shrink-0 px-4 border-b border-border shadow-[0_4px_10px_-1px_rgba(0,0,0,0.05)]'>
          <div className='flex items-center gap-1 py-3'>
            <div className='min-w-0 flex-1 px-1.5'>
              <span className='whitespace-nowrap text-base font-semibold leading-7 text-foreground'>
                Calendar
              </span>
            </div>
          </div>

          <div className='relative z-10 flex h-14 items-center gap-3'>
            <Button
              variant='outline'
              size='iconSm'
              title='Previous week'
              aria-label='Previous week'
              onClick={() => goToWeek(addDays(currentWeekStart, -7))}
              className='size-7 rounded-lg'
            >
              <ChevronLeft className='size-4' strokeWidth={2} aria-hidden='true' />
            </Button>
            <Button
              variant='outline'
              size='iconSm'
              title='Next week'
              aria-label='Next week'
              onClick={() => goToWeek(addDays(currentWeekStart, 7))}
              className='size-7 rounded-lg'
            >
              <ChevronRight className='size-4' strokeWidth={2} aria-hidden='true' />
            </Button>

            <DatePicker
              selectedDate={currentWeekStart}
              onSelect={date => date && goToWeek(startOfDay(date))}
              showClearButton={false}
              inputClassName='min-w-0 flex-1 border-0 bg-transparent px-2 shadow-none rounded-lg'
              contentClassName='z-50'
              displayLabel={formatWeekRangeLabel(currentWeekStart)}
            />

            <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
              {callCountLabel}
            </span>

            <Button
              variant='outline'
              size='sm'
              onClick={() => goToWeek(startOfDay(new Date()))}
              disabled={isSameWeek(currentWeekStart, new Date(), { weekStartsOn: 0 })}
              className='rounded-full'
            >
              This Week
            </Button>
          </div>
        </header>

        <div className='min-h-0 flex-1 overflow-hidden [&>div]:border-0'>
          <CalendarWeekView
            key={callId ?? 'none'}
            calls={allCalls}
            currentWeekStart={currentWeekStart}
            currentUserId={user?.id}
            initialOpenCallId={callId}
            onCallClick={handleCallRowClick}
            onGotoMessage={handleGotoTranscript}
            onDownloadTranscript={handleDownloadTranscript}
            onEditClick={handleEditClick}
            onDeleteClick={handleDeleteClick}
            onCreateCallAtSlot={handleCreateCallAtSlot}
            channelPresentationsById={channelPresentationsById}
          />
        </div>
      </div>

      <ScheduleCallModal
        isOpen={editModalOpen}
        onClose={closeEditModal}
        mode='edit'
        initialCall={editModalCall}
        onSuccess={closeEditModal}
      />

      <DeleteCallModal
        isOpen={deleteModalOpen}
        onClose={closeDeleteModal}
        onConfirm={handleDeleteConfirm}
        callLabel={
          deleteModalCall
            ? `${deleteModalCall.title ?? 'Scheduled Call'}${
                deleteModalCall.startsAt
                  ? ` | ${new Date(deleteModalCall.startsAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                    })} ${new Date(deleteModalCall.startsAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}`
                  : ''
              }`
            : ''
        }
        isRecurring={!!deleteModalCall?.recurringSeriesId}
      />

      <ScheduleCallModal
        isOpen={scheduleInitialTime !== null}
        onClose={() => setScheduleInitialTime(null)}
        initialStartsAt={scheduleInitialTime?.startsAt ?? null}
        initialEndsAt={scheduleInitialTime?.endsAt ?? null}
      />
    </div>
  );
};
