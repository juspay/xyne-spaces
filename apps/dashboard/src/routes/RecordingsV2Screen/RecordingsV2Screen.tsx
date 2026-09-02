import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { LayersTo, Spinner } from '@xyne/icons';
import { CallStatus, TagMethod } from '@xyne/shared';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog';
import {
  refreshOatsRecordings,
  usePaginatedOatsRecordings,
  type OatsRecordingEntry,
} from '../../hooks/usePaginatedOatsRecordings';
import { recordingService } from '../../services/Recording/recordingService';
import { logRecordingError } from '../../utils/recordingUtils';
import { RecordingShareModal } from '../RecordingDetailV2Screen/components/RecordingShareModal';
import { usePlatform } from '../../hooks/usePlatform';
import { getRecordingDefaultLayout } from '../../hooks/useRecordingDefaultLayout';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { useSelf, useUsers } from '../../hooks/useUsers';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { cn } from '../../utils/classNames';
import { RecordingsEmptyStateIllustration } from './components/RecordingsEmptyStateIllustration';
import { RecordingDateFilter } from './components/RecordingDateFilter';
import RecordingControlsOverlay from './components/RecordingControlsOverlay';
import { RecordingLabelFilter } from './components/RecordingLabelFilter';
import { RecordingPeopleFilter } from './components/RecordingPeopleFilter';
import { RecordingSharedWithMeTab } from './components/RecordingSharedWithMeTab';
import RecordingAskAIModal from './components/RecordingAskAIModal';
import RecordingsV2Pill, {
  RecordingsV2LivePill,
  type RecordingsV2PillRecording,
} from './components/RecordingsV2Pill';
import { RecordingsV2Skeleton } from './components/RecordingsV2Skeleton';
import { RecordingDeleteDialog } from './components/RecordingDeleteDialog';
import { useResolvedRecordingLabels } from '../../hooks/useResolvedRecordingLabels';
import {
  buildRecordingRows,
  filterRecordingsByLabels,
  filterRecordingsByOwnership,
  findNearestVisibleRecording,
  formatRecordingParticipants,
  getRecordingDatePresetLabel,
  isRecordingInDatePreset,
  LIST_TAB_CLASS_NAME,
  type RecordingDatePreset,
  type RecordingOwnershipTab,
} from './utils/RecordingsV2.utils';
import { getRecordingParticipantIds, normalizeRecordingTags } from '../../utils/recordingUtils';
import { DEFAULT_RECORDING_TITLE, readRecordingCanvasIds } from '@/utils/recordingUtils';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { SummaryTemplatesModal } from '../RecordingDetailV2Screen/components/SummaryTemplatesModal';
import { useSummaryTemplates } from '../../hooks/useSummaryTemplates';

const RecordingsV2Screen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const requestedSummaryTemplateId = searchParams.get('summaryTemplateId');
  const shouldOpenTemplatesFromUrl =
    searchParams.get('templates') === '1' || requestedSummaryTemplateId !== null;
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const listTabParam = searchParams.get('tab');
  const activeListTab: RecordingOwnershipTab =
    listTabParam === 'created' || listTabParam === 'shared' ? listTabParam : 'all';
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [selectedDatePreset, setSelectedDatePreset] = useState<RecordingDatePreset>('all-time');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedSharerIds, setSelectedSharerIds] = useState<string[]>([]);
  const [showAskAIContextModal, setShowAskAIContextModal] = useState(false);
  const [shareRecording, setShareRecording] = useState<RecordingsV2PillRecording | null>(null);
  const [deleteRecording, setDeleteRecording] = useState<RecordingsV2PillRecording | null>(null);
  const showTemplatesModal = shouldOpenTemplatesFromUrl;
  const { templates: summaryTemplates, isLoading: summaryTemplatesLoading } =
    useSummaryTemplates(showTemplatesModal);
  const {
    recordings,
    hasMoreRecordings,
    loadMoreRecordings,
    onVisibleRangeChanged,
    isLoading,
    error,
    refreshRecordings,
  } = usePaginatedOatsRecordings(activeListTab, selectedCreatorId);
  const currentUser = useSelf();
  const users = useUsers();
  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const recordingStatus = useRecordingStore(context => context.status);
  const recordingStartTime = useRecordingStore(context => context.startTime);
  const recordingCallId = useRecordingStore(context => context.externalId);
  const recordingTitle = useRecordingStore(context => context.title);
  const recordingPauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const recordingAccumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const pendingAutoStart = useRecordingStore(context => context.pendingAutoStart);
  const handleOpenTemplates = useCallback((): void => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.set('templates', '1');
      return next;
    });
  }, [setSearchParams]);

  const handleCloseTemplates = useCallback((): void => {
    setSearchParams(
      current => {
        const next = new URLSearchParams(current);
        next.delete('templates');
        next.delete('summaryTemplateId');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleStartRecording = useCallback((): void => {
    if (recordingStatus !== 'idle' && recordingStatus !== 'error') return;

    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({
      type: 'startRecording',
      defaultLayout: getRecordingDefaultLayout(),
    });
  }, [recordingStatus]);

  useEffect(() => {
    if (pendingAutoStart && (recordingStatus === 'idle' || recordingStatus === 'error')) {
      handleStartRecording();
    }
  }, [handleStartRecording, pendingAutoStart, recordingStatus]);

  const availableCreators = useMemo(() => {
    const creatorIds = new Set(recordings.map(recording => recording.createdByUserId));
    return users.filter(user => creatorIds.has(user.id));
  }, [recordings, users]);

  const availableLabels = useMemo(
    () =>
      normalizeRecordingTags(recordings.flatMap(recording => recording.labels)).sort(
        (left, right) => left.localeCompare(right),
      ),
    [recordings],
  );
  // recording.labels stores Tag ids (no FK), not display text — resolve them
  // to their actual value once here so both the filter dropdown and the
  // per-row chips show real label names instead of raw ids. Every id is passed
  // in, including generated ones, since resolving is also what reveals the method.
  const { resolveLabel, resolveMethod, isResolved } = useResolvedRecordingLabels(availableLabels);

  const isManualLabel = useCallback(
    (label: string): boolean => resolveMethod(label) === TagMethod.MANUAL,
    [resolveMethod],
  );
  const manualLabels = useMemo(
    () => availableLabels.filter(isResolved).filter(isManualLabel),
    [availableLabels, isResolved, isManualLabel],
  );

  /**
   * The People filter is applied server-side by the recordings query, so only the
   * tab's shared-by picker still narrows the loaded page — and an explicit pick in
   * the People filter wins over it.
   */
  const ownershipFilteredRecordings = useMemo(
    () => filterRecordingsByOwnership(recordings, selectedCreatorId ? [] : selectedSharerIds),
    [recordings, selectedCreatorId, selectedSharerIds],
  );

  const liveRecording = useMemo(() => {
    const activeRecordings = ownershipFilteredRecordings.filter(
      recording => recording.status === CallStatus.ACTIVE,
    );
    if (recordingCallId) {
      return activeRecordings.find(recording => recording.externalId === recordingCallId) ?? null;
    }
    return activeRecordings[0] ?? null;
  }, [ownershipFilteredRecordings, recordingCallId]);
  const isLocalRecordingActive = recordingStatus === 'recording' || recordingStatus === 'paused';
  const showRecordingLauncher = !isLocalRecordingActive;
  const liveRecordingStartedAt =
    liveRecording?.startedAt ?? (isLocalRecordingActive ? recordingStartTime : null);
  const liveRecordingTitle = liveRecording?.title ?? recordingTitle ?? DEFAULT_RECORDING_TITLE;
  const isOwnRecordingView =
    activeListTab !== 'shared' && (!selectedCreatorId || selectedCreatorId === currentUser?.id);
  const showLiveRecording =
    isOwnRecordingView && liveRecordingStartedAt !== null && isLocalRecordingActive;
  const hiddenLiveRecordingId =
    recordingCallId ?? (recordingStatus === 'starting' ? liveRecording?.externalId : null);

  const filteredRecordings = useMemo(
    () =>
      filterRecordingsByLabels(
        ownershipFilteredRecordings.filter(
          // Hide the local live row
          recording =>
            recording.externalId !== hiddenLiveRecordingId &&
            isRecordingInDatePreset(recording.startedAt, selectedDatePreset),
        ),
        selectedLabels,
      ),
    [ownershipFilteredRecordings, hiddenLiveRecordingId, selectedDatePreset, selectedLabels],
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

  const setActiveListTab = useCallback(
    (tab: RecordingOwnershipTab): void => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (tab === 'all') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleTabChange = useCallback(
    (tab: RecordingOwnershipTab): void => {
      if (tab === activeListTab) return;

      setActiveListTab(tab);
      setSelectedCreatorId(null);
      setSelectedLabels([]);
      setSelectedSharerIds([]);
    },
    [activeListTab, setActiveListTab],
  );

  const handleCreatorChange = useCallback((creatorId: string | null): void => {
    setSelectedCreatorId(creatorId);
  }, []);

  const handleOpenRecording = useCallback(
    (recordingId: string): void => {
      void navigate(`/recordings/${recordingId}`, {
        state: {
          recordingIds: filteredRecordings.map(recording => recording.externalId),
          from: `${location.pathname}${location.search}`,
        },
      });
    },
    [filteredRecordings, location.pathname, location.search, navigate],
  );

  const handleOpenLiveRecordingWindow = useCallback(
    (recordingId: string): void => {
      void navigate(`/recordings/${recordingId}`, {
        state: {
          recordingIds: filteredRecordings.map(recording => recording.externalId),
          from: `${location.pathname}${location.search}`,
        },
      });
    },
    [filteredRecordings, location.pathname, location.search, navigate],
  );

  const handleShareRecording = useCallback((recording: RecordingsV2PillRecording): void => {
    setShareRecording(recording);
  }, []);

  const handleRequestDeleteRecording = useCallback((recording: RecordingsV2PillRecording): void => {
    setDeleteRecording(recording);
  }, []);

  const handleConfirmDeleteRecording = useCallback(async (): Promise<void> => {
    if (!deleteRecording) return;

    const target = deleteRecording;
    setDeleteRecording(null);
    try {
      await recordingService.deleteRecording(target.externalId);
      refreshOatsRecordings();
      toast.success('Recording deleted');
    } catch (err) {
      logRecordingError('RecordingsV2Screen.deleteRecording', err);
      toast.error('Failed to delete recording');
    }
  }, [deleteRecording]);

  const handleOpenAskAI = useCallback((): void => {
    setShowAskAIContextModal(true);
  }, []);

  const handleConfirmAskAIContext = useCallback((selected: OatsRecordingEntry[]): void => {
    // Attach each recording's documents alongside the recording itself, the same
    // way the detail screen does — otherwise Ask AI opened from the list gets only
    // the call and has to rediscover the summary and the user's notes. Each canvas
    // carries its role, because from the row alone the machine-written summary and
    // the human's notes are indistinguishable.
    const canvases = selected.flatMap(recording => {
      const title = recording.title || DEFAULT_RECORDING_TITLE;
      const { summaryCanvasId, notesCanvasId } = readRecordingCanvasIds(recording.metadata);
      return [
        ...(summaryCanvasId
          ? [
              {
                id: summaryCanvasId,
                canvasId: summaryCanvasId,
                title: `${title} summary`,
                canvasRole: 'call-summary' as const,
              },
            ]
          : []),
        ...(notesCanvasId && notesCanvasId !== summaryCanvasId
          ? [
              {
                id: notesCanvasId,
                canvasId: notesCanvasId,
                title: `${title} notes`,
                canvasRole: 'call-notes' as const,
              },
            ]
          : []),
      ];
    });

    xyneAIActor.send({
      type: 'OPEN',
      contextType: 'general',
      threadInfo: null,
      startFreshChat: true,
      initialContextSelections: {
        canvases,
        recordings: selected.map(recording => ({
          id: recording.id,
          title: recording.title || DEFAULT_RECORDING_TITLE,
          externalId: recording.externalId,
          ...(recording.channelId ? { channelId: recording.channelId } : {}),
        })),
      },
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
      aria-labelledby='xyne-scribe-heading'
    >
      {/* Floated rather than in-flow so the list keeps the full viewport height.
          `w-fit` gives the shrink-to-fit box a definite width for the navigator's
          own `w-full`; z-30 keeps it above the sticky header (z-20), which
          otherwise covers it once the centred column reaches the left edge. */}
      {!isMobile && (
        <div className='absolute left-0 top-0 z-30 hidden h-[52px] w-fit md:block'>
          <AppNavigator />
        </div>
      )}
      <div ref={setScrollContainer} className='h-full w-full overflow-y-scroll'>
        <div className='flex min-h-full w-full flex-col items-center px-4'>
          <header className='max-w-[860px] w-full sticky top-0 bg-background z-20 pt-6 pb-6 sm:pb-3'>
            <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-6'>
              <div className='col-start-1 row-start-1 min-w-0'>
                <h1 id='xyne-scribe-heading' className='text-3xl font-semibold text-foreground'>
                  Xyne Scribe
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
                    aria-pressed={activeListTab === 'all'}
                    onClick={() => handleTabChange('all')}
                    className={cn(
                      LIST_TAB_CLASS_NAME,
                      activeListTab === 'all'
                        ? 'bg-background text-foreground font-medium'
                        : 'text-muted-foreground/80 hover:text-foreground',
                    )}
                    data-track-category='RecordingsV2'
                    data-track-name='show_all_recordings'
                  >
                    All
                  </button>
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
                  <RecordingSharedWithMeTab
                    isActive={activeListTab === 'shared'}
                    onActivate={() => handleTabChange('shared')}
                    sharers={activeListTab === 'shared' ? availableCreators : []}
                    selectedSharerIds={selectedSharerIds}
                    onSelectedSharerIdsChange={setSelectedSharerIds}
                  />
                </div>

                <RecordingDateFilter value={selectedDatePreset} onChange={setSelectedDatePreset} />

                <RecordingPeopleFilter
                  creators={users}
                  currentUserId={currentUser?.id}
                  selectedUserId={selectedCreatorId}
                  onUserChange={handleCreatorChange}
                />

                <RecordingLabelFilter
                  labels={manualLabels}
                  selectedLabels={selectedLabels}
                  onSelectedLabelsChange={setSelectedLabels}
                  resolveLabel={resolveLabel}
                />
              </div>

              <div className='col-start-2 row-start-1 flex items-center gap-2 sm:row-start-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleOpenTemplates}
                  className='h-9 gap-1.5 whitespace-nowrap rounded-xl border-border px-4 font-semibold hover:bg-muted/70'
                  data-track-category='RecordingsV2'
                  data-track-name='open_summary_templates'
                >
                  <LayersTo className='size-4' strokeWidth={2} />
                  Templates
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleOpenAskAI}
                  className='h-9 gap-1.5 whitespace-nowrap rounded-xl border-border px-4 font-semibold hover:bg-muted/70'
                  data-track-category='RecordingsV2'
                  data-track-name='open_ask_ai'
                >
                  <XyneAIStar size={15} />
                  Ask AI
                </Button>
              </div>
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
                  className='pb-4 pt-2'
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
                    title={liveRecordingTitle}
                    startedAt={liveRecordingStartedAt}
                    isPaused={recordingStatus === 'paused'}
                    pauseStartedAt={recordingPauseStartedAt}
                    accumulatedPausedMs={recordingAccumulatedPausedMs}
                    onOpenWindow={() => {
                      const openId = recordingCallId ?? liveRecording?.externalId;
                      if (openId) handleOpenLiveRecordingWindow(openId);
                    }}
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
                  {selectedCreatorId !== null ||
                  selectedSharerIds.length > 0 ||
                  selectedLabels.length > 0 ||
                  ownershipFilteredRecordings.length > 0
                    ? 'No matching recordings'
                    : activeListTab === 'shared'
                      ? 'No shared recordings yet'
                      : 'Start your first recording'}
                </h2>
                <p className='mt-1 min-h-10 max-w-sm text-sm text-muted-foreground'>
                  {selectedLabels.length > 0
                    ? 'No recordings match the selected labels.'
                    : ownershipFilteredRecordings.length > 0
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
                        participantsLabel={formatRecordingParticipants(
                          getRecordingParticipantIds(
                            row.recording.createdByUserId,
                            row.recording.recordingParticipants,
                          ),
                          usersById,
                          currentUser?.id,
                        )}
                        tags={row.recording.labels.filter(isResolved).filter(isManualLabel)}
                        suggestedTags={row.recording.labels.filter(
                          label =>
                            isResolved(label) && resolveMethod(label) === TagMethod.AUTOMATED,
                        )}
                        pendingLabelCount={
                          row.recording.labels.filter(label => !isResolved(label)).length
                        }
                        resolveLabel={resolveLabel}
                        currentUserId={currentUser?.id}
                        onOpen={handleOpenRecording}
                        onShare={handleShareRecording}
                        onDelete={handleRequestDeleteRecording}
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

      {currentUser && showTemplatesModal && (
        <Dialog
          open
          onOpenChange={open => !open && handleCloseTemplates()}
          title='Templates'
          description='Create, edit, and share recording summary templates.'
          className='h-full max-h-[824px] w-full max-w-screen-lg overflow-hidden rounded-2xl p-0'
          testId='recordings-summary-templates-dialog'
        >
          <SummaryTemplatesModal
            templates={summaryTemplates}
            loading={summaryTemplatesLoading}
            selectedTemplateId={requestedSummaryTemplateId}
            currentUserId={currentUser.id}
            currentUserName={getUserDisplayName(currentUser)}
            onClose={handleCloseTemplates}
          />
        </Dialog>
      )}

      {showAskAIContextModal && (
        <RecordingAskAIModal
          open={showAskAIContextModal}
          recordings={ownershipFilteredRecordings}
          users={users}
          currentUserId={currentUser?.id}
          resolveLabel={resolveLabel}
          onOpenChange={setShowAskAIContextModal}
          onConfirm={handleConfirmAskAIContext}
        />
      )}

      {shareRecording && (
        <Dialog
          open
          onOpenChange={open => !open && setShareRecording(null)}
          title='Share recording'
          testId='recordings-v2-share-dialog'
        >
          <RecordingShareModal recording={shareRecording} onClose={() => setShareRecording(null)} />
        </Dialog>
      )}

      <RecordingDeleteDialog
        recording={deleteRecording}
        onOpenChange={open => !open && setDeleteRecording(null)}
        onConfirm={() => void handleConfirmDeleteRecording()}
      />
    </div>
  );
};

export default RecordingsV2Screen;
