import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { Spinner } from '@xyne/icons';
import { CallStatus } from '@xyne/shared';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { Button } from '../../components/ui/Button/Button';
import { usePaginatedOatsRecordings } from '../../hooks/usePaginatedOatsRecordings';
import { getRecordingDefaultLayout } from '../../hooks/useRecordingDefaultLayout';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { useSelf, useUsers } from '../../hooks/useUsers';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useShortcutById } from '../../shortcuts';
import { cn } from '../../utils/classNames';
import { RecordingsEmptyStateIllustration } from './components/RecordingsEmptyStateIllustration';
import { RecordingDateFilter } from './components/RecordingDateFilter';
import RecordingControlsOverlay from './components/RecordingControlsOverlay';
import { RecordingPeopleFilter } from './components/RecordingPeopleFilter';
import RecordingsV2Pill, { RecordingsV2LivePill } from './components/RecordingsV2Pill';
import { RecordingsV2Skeleton } from './components/RecordingsV2Skeleton';
import {
  buildRecordingRows,
  filterRecordingsByOwnership,
  findNearestVisibleRecording,
  getRecordingDatePresetLabel,
  isRecordingInDatePreset,
  LIST_TAB_CLASS_NAME,
  type RecordingDatePreset,
  type RecordingOwnershipTab,
} from './utils/RecordingsV2.utils';
import { DEFAULT_RECORDING_TITLE } from '@/stores/recordingStore';

const RecordingsV2Screen = (): ReactElement => {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [activeListTab, setActiveListTab] = useState<RecordingOwnershipTab>('created');
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [selectedDatePreset, setSelectedDatePreset] = useState<RecordingDatePreset>('this-week');
  const {
    recordings,
    hasMoreRecordings,
    loadMoreRecordings,
    onVisibleRangeChanged,
    isLoading,
    error,
    refreshRecordings,
  } = usePaginatedOatsRecordings(activeListTab);
  const currentUser = useSelf();
  const users = useUsers();
  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const recordingStatus = useRecordingStore(context => context.status);
  const recordingStartTime = useRecordingStore(context => context.startTime);
  const recordingCallId = useRecordingStore(context => context.externalId);
  const recordingPauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const recordingAccumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const pendingAutoStart = useRecordingStore(context => context.pendingAutoStart);

  const handleStartRecording = useCallback((): void => {
    if (recordingStatus !== 'idle' && recordingStatus !== 'error') return;

    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({
      type: 'startRecording',
      defaultLayout: getRecordingDefaultLayout(),
    });
  }, [recordingStatus]);

  useShortcutById('recording.start', handleStartRecording, {
    enabled: recordingStatus === 'idle' || recordingStatus === 'error',
  });

  useEffect(() => {
    if (pendingAutoStart && (recordingStatus === 'idle' || recordingStatus === 'error')) {
      handleStartRecording();
    }
  }, [handleStartRecording, pendingAutoStart, recordingStatus]);

  const availableCreators = useMemo(() => {
    const creatorIds = new Set(recordings.map(recording => recording.createdByUserId));
    return users.filter(user => creatorIds.has(user.id));
  }, [recordings, users]);

  const ownershipFilteredRecordings = useMemo(
    () => filterRecordingsByOwnership(recordings, selectedCreatorId),
    [recordings, selectedCreatorId],
  );

  const liveRecording = useMemo(
    () =>
      ownershipFilteredRecordings.find(
        recording =>
          recording.status === CallStatus.ACTIVE &&
          (!recordingCallId || recording.externalId === recordingCallId),
      ) ??
      ownershipFilteredRecordings.find(recording => recording.status === CallStatus.ACTIVE) ??
      null,
    [ownershipFilteredRecordings, recordingCallId],
  );
  const isLocalRecordingActive = recordingStatus === 'recording' || recordingStatus === 'paused';
  const showRecordingLauncher = !isLocalRecordingActive;
  const liveRecordingStartedAt =
    liveRecording?.startedAt ?? (isLocalRecordingActive ? recordingStartTime : null);
  const isOwnRecordingView =
    activeListTab === 'created' && (!selectedCreatorId || selectedCreatorId === currentUser?.id);
  const showLiveRecording =
    isOwnRecordingView && liveRecordingStartedAt !== null && isLocalRecordingActive;

  const filteredRecordings = useMemo(
    () =>
      ownershipFilteredRecordings.filter(
        recording =>
          recording.status !== CallStatus.ACTIVE &&
          isRecordingInDatePreset(recording.startedAt, selectedDatePreset),
      ),
    [ownershipFilteredRecordings, selectedDatePreset],
  );
  const recordingsCapturedThisWeek = useMemo(
    () =>
      ownershipFilteredRecordings.filter(recording =>
        isRecordingInDatePreset(recording.startedAt, 'this-week'),
      ).length,
    [ownershipFilteredRecordings],
  );

  const rows = useMemo(() => buildRecordingRows(filteredRecordings), [filteredRecordings]);
  const sourceIndexByRecordingId = useMemo(
    () => new Map(recordings.map((recording, index) => [recording.id, index])),
    [recordings],
  );

  const handleTabChange = useCallback((tab: RecordingOwnershipTab): void => {
    setActiveListTab(tab);
    setSelectedCreatorId(null);
  }, []);

  const handleCreatorChange = useCallback(
    (creatorId: string | null): void => {
      setSelectedCreatorId(creatorId);
      if (creatorId) {
        setActiveListTab(creatorId === currentUser?.id ? 'created' : 'shared');
      }
    },
    [currentUser?.id],
  );

  const handleOpenRecording = useCallback(
    (recordingId: string): void => {
      void navigate(`/recordings/${recordingId}`, {
        state: { recordingIds: filteredRecordings.map(recording => recording.externalId) },
      });
    },
    [filteredRecordings, navigate],
  );

  const handleOpenLiveRecordingWindow = useCallback(
    (recordingId: string): void => {
      void navigate(`/recordings/${recordingId}`, {
        state: { recordingIds: filteredRecordings.map(recording => recording.externalId) },
      });
    },
    [filteredRecordings, navigate],
  );

  const handleOpenAskAI = useCallback((): void => {
    xyneAIActor.send({
      type: 'OPEN',
      contextType: 'general',
      threadInfo: null,
      startFreshChat: true,
    });
  }, []);

  const handleVisibleRangeChanged = useCallback(
    (startIndex: number): void => {
      const firstVisibleRecording = findNearestVisibleRecording(rows, startIndex);
      if (!firstVisibleRecording) return;

      const sourceIndex = sourceIndexByRecordingId.get(firstVisibleRecording.id);
      if (sourceIndex !== undefined) {
        onVisibleRangeChanged(sourceIndex);
      }
    },
    [onVisibleRangeChanged, rows, sourceIndexByRecordingId],
  );

  const isInitialLoading = isLoading && recordings.length === 0;
  const showInitialSkeleton = isInitialLoading;

  return (
    <div
      data-testid='recordings-v2-page'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
      aria-labelledby='xyne-oats-heading'
    >
      <div ref={setScrollContainer} className='h-full w-full overflow-y-scroll'>
        <div className='flex min-h-full w-full flex-col items-center px-4'>
          <header className='max-w-[860px] w-full sticky top-0 bg-background z-20 pt-6 pb-6 sm:pb-3'>
            <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-6'>
              <div className='col-start-1 row-start-1 min-w-0'>
                <h1 id='xyne-oats-heading' className='text-3xl font-semibold text-foreground'>
                  Xyne Oats
                </h1>
                <p className='mt-1 text-sm text-muted-foreground/70'>
                  {ownershipFilteredRecordings.length} recordings · {recordingsCapturedThisWeek}{' '}
                  captured this week
                </p>
              </div>

              <div className='col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-1 sm:gap-3'>
                <div
                  className='flex w-full items-center gap-1 rounded-xl bg-muted p-1 sm:w-auto'
                  role='group'
                  aria-label='Filter recordings by ownership'
                >
                  <button
                    type='button'
                    aria-pressed={activeListTab === 'created'}
                    onClick={() => handleTabChange('created')}
                    className={cn(
                      LIST_TAB_CLASS_NAME,
                      activeListTab === 'created'
                        ? 'bg-background text-foreground font-medium'
                        : 'text-muted-foreground/80 hover:text-foreground',
                    )}
                    data-track-category='RecordingsV2'
                    data-track-name='show_created_by_me'
                  >
                    Created by me
                  </button>
                  <button
                    type='button'
                    aria-pressed={activeListTab === 'shared'}
                    onClick={() => handleTabChange('shared')}
                    className={cn(
                      LIST_TAB_CLASS_NAME,
                      activeListTab === 'shared'
                        ? 'bg-background text-foreground font-medium'
                        : 'text-muted-foreground/80 hover:text-foreground',
                    )}
                    data-track-category='RecordingsV2'
                    data-track-name='show_shared_with_me'
                  >
                    Shared with me
                  </button>
                </div>

                <RecordingDateFilter value={selectedDatePreset} onChange={setSelectedDatePreset} />

                <RecordingPeopleFilter
                  creators={availableCreators}
                  currentUserId={currentUser?.id}
                  selectedUserId={selectedCreatorId}
                  onUserChange={handleCreatorChange}
                />
              </div>

              <Button
                type='button'
                variant='outline'
                onClick={handleOpenAskAI}
                className='col-start-2 row-start-1 h-9 gap-1.5 whitespace-nowrap rounded-xl border-border px-4 font-semibold hover:bg-muted/70 sm:row-start-2'
                data-track-category='RecordingsV2'
                data-track-name='open_ask_ai'
              >
                <XyneAIStar size={15} />
                Ask AI
              </Button>
            </div>
          </header>

          <AnimatePresence initial={false}>
            {showLiveRecording && (
              <motion.div
                key='live-recording-pill'
                className='w-full max-w-[860px]'
                initial={shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : {
                        height: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
                        opacity: { duration: 0.2, ease: 'easeOut' },
                      }
                }
              >
                <motion.div
                  className='pb-4'
                  initial={
                    shouldReduceMotion ? { opacity: 1 } : { y: -14, scale: 0.99, opacity: 0 }
                  }
                  animate={{ y: 0, scale: 1, opacity: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { y: -8, scale: 0.995, opacity: 0 }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { duration: 0.34, delay: 0.04, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <RecordingsV2LivePill
                    title={liveRecording?.title ?? DEFAULT_RECORDING_TITLE}
                    startedAt={liveRecordingStartedAt}
                    isPaused={recordingStatus === 'paused'}
                    pauseStartedAt={recordingPauseStartedAt}
                    accumulatedPausedMs={recordingAccumulatedPausedMs}
                    onOpenWindow={() =>
                      liveRecording && handleOpenLiveRecordingWindow(liveRecording.externalId)
                    }
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <main className='flex w-full max-w-[860px] flex-1 flex-col'>
            {showInitialSkeleton ? (
              <RecordingsV2Skeleton />
            ) : error && recordings.length === 0 ? (
              <div
                className='flex flex-1 flex-col items-center justify-center px-6 pb-28 text-center'
                role='alert'
              >
                <RecordingsEmptyStateIllustration />
                <h2 className='text-base font-semibold text-foreground'>
                  Couldn’t load recordings
                </h2>
                <p className='mt-1 max-w-md text-sm leading-6 text-muted-foreground'>
                  Something went wrong while loading recordings.
                </p>
                <Button
                  type='button'
                  onClick={refreshRecordings}
                  className='mt-5 rounded-3xl px-4 font-semibold shadow-sm'
                  data-track-category='RecordingsV2'
                  data-track-name='retry_load_recordings'
                >
                  Try again
                </Button>
              </div>
            ) : filteredRecordings.length === 0 && !showLiveRecording ? (
              <div className='flex flex-1 flex-col items-center justify-center px-6 pb-28 text-center'>
                <RecordingsEmptyStateIllustration />
                <h2 className='text-base font-semibold text-foreground'>
                  {selectedCreatorId || ownershipFilteredRecordings.length > 0
                    ? 'No matching recordings'
                    : activeListTab === 'shared'
                      ? 'No shared recordings yet'
                      : 'Start your first recording'}
                </h2>
                <p className='mt-1 min-h-10 max-w-sm text-sm text-muted-foreground'>
                  {ownershipFilteredRecordings.length > 0
                    ? `No recordings found for ${getRecordingDatePresetLabel(selectedDatePreset).toLowerCase()}.`
                    : selectedCreatorId
                      ? 'Try another ownership tab or person.'
                      : activeListTab === 'shared'
                        ? 'Recordings shared with you by others will appear here.'
                        : 'Capture a conversation and explore it with Ask AI.'}
                </p>
              </div>
            ) : filteredRecordings.length > 0 && scrollContainer ? (
              <Virtuoso
                customScrollParent={scrollContainer}
                data={rows}
                useWindowScroll={false}
                atBottomThreshold={100}
                endReached={loadMoreRecordings}
                rangeChanged={range => handleVisibleRangeChanged(range.startIndex)}
                computeItemKey={(_, row) => row.id}
                components={{
                  Footer: () => (
                    <div className='pb-24'>
                      {hasMoreRecordings && (
                        <div
                          className='flex items-center justify-center py-5 text-muted-foreground'
                          role='status'
                          aria-label='Loading more recordings'
                        >
                          <Spinner size={20} className='animate-spin' />
                        </div>
                      )}
                    </div>
                  ),
                }}
                itemContent={(_, row) =>
                  row.type === 'group' ? (
                    <div className='sticky top-24 z-10 py-2 text-sm font-medium text-muted-foreground/70'>
                      {row.label}
                    </div>
                  ) : (
                    <div className='pb-2'>
                      <RecordingsV2Pill
                        recording={row.recording}
                        creator={usersById.get(row.recording.createdByUserId) ?? null}
                        tags={row.recording.labels}
                        onOpen={handleOpenRecording}
                      />
                    </div>
                  )
                }
              />
            ) : null}
          </main>
        </div>
      </div>

      <AnimatePresence initial={false} mode='sync'>
        {showRecordingLauncher && (
          <RecordingControlsOverlay
            key='recording-launcher'
            status={recordingStatus}
            onStart={handleStartRecording}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default RecordingsV2Screen;
