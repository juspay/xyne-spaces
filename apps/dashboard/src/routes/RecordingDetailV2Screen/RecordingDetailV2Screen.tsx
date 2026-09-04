/**
  The Xyne Scribe Details Screen 
 */

import { type ReactElement, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  recordingService,
  type RecordingDetail,
  type RecordingTicketLinkState,
} from '../../services/Recording/recordingService';
import { useShortcut } from '../../shortcuts';
import { RefreshCw, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import {
  logRecordingError,
  NO_TRANSCRIPT_AFTER_MS,
  resolveRecordingTitle,
} from '../../utils/recordingUtils';
import {
  getRecordingV2Tab,
  setRecordingV2Tab,
  getLiveRecordingV2Tab,
  setLiveRecordingV2Tab,
  type RecordingV2Tab,
} from '../../utils/recordingTabPreference';
import {
  clearSummaryRequested,
  getSummaryProgress,
  getSummaryRequest,
  getSummaryStage,
  markSummaryRequested,
  saveSummaryProgress,
} from '../../utils/recordingSummaryRequest';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { usePlatform } from '../../hooks/usePlatform';
import { SPEAKER_LABELS_APPLIED_EVENT } from '../../services/Recording/localSpeakerTap';
import {
  Spinner,
  Flag,
  SidebarRightOpen,
  ChevronDown,
  File02Text,
  EnvelopeDefault,
  Hashtag,
  SidebarRightClose,
  Share02,
} from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Popover } from '../../components/ui/Popover';
import { cn, Tooltip } from '../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import XyneAIStar from '../../components/icons/xyne-ai/XyneAIStar';
import { RecordingDetailV2Header } from './components/RecordingDetailV2Header';
import { RecordingShareModal } from './components/RecordingShareModal';
import { RecordingDetailV2Skeleton } from './components/RecordingDetailV2Skeleton';
import { RecordingLoadError } from './components/RecordingLoadError/RecordingLoadError';
import {
  classifyRecordingLoadFailure,
  describeRecordingLoadFailure,
  type RecordingLoadFailure,
} from './components/RecordingLoadError/recordingLoadError.util';
import { LiveRecordingControlBar } from './components/LiveRecordingControlBar';
import { LiveTranscriptSection } from './components/LiveTranscriptSection';
import { ResumeRecordingButton } from './components/ResumeRecordingButton';
import {
  RecordingContentTabs,
  type RecordingSummaryTemplate,
} from './components/RecordingContentTabs';
import { SummaryGenerationPanel } from './components/SummaryGenerationPill/SummaryGenerationPanel';
import { deriveSummaryPanelState } from './summaryPanelState';
import { PostRecordingToChannelModal } from './components/PostRecordingToChannelModal';
import { PostRecordingToEmailModal } from './components/PostRecordingToEmailModal';
import { GoogleDocPreviewModal } from './components/GoogleDocPreviewModal';
import {
  RecordingGoogleDocsList,
  parseRecordingGoogleDocLinks,
} from './components/RecordingGoogleDocsList';
import { CollaborativeCanvasEditor } from '../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { useMarkMoment } from '../../hooks/useMarkMoment';
import { useRecordingTitleState } from '../../hooks/useRecordingTitleState';
import { queries } from '../../zero/queries';
import {
  TranscriptSidePanel,
  type TranscriptPanelTarget,
} from '../../components/Chat/TranscriptCitationModal/TranscriptSidePanel';
import { transcriptCitationStore } from '../../components/Chat/TranscriptCitationModal';
import { parseMarkedItems, type MarkedItem } from './components/markedItems';
import type { Canvas } from '../../components/Canvas/Canvas.types';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useSelf } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { SummaryTemplatesModal, getTemplateIcon } from './components/SummaryTemplatesModal';
import { useSummaryTemplates } from '../../hooks/useSummaryTemplates';
import { useSummaryModelPreference } from '../../hooks/useSummaryModelPreference';

const EMPTY_LABEL_SUGGESTIONS: string[] = [];

interface RecordingNavState {
  recordingIds?: string[];
  /**
   * Labels the recordings list had loaded when this recording was opened. Only
   * the picker's suggestion list — a deep link arrives without them and just
   * offers whatever is already on the recording.
   */
  labelSuggestions?: string[];
  from?: string;
  justStopped?: boolean;
  durationMs?: number;
  endedAtMs?: number;
  hasTranscript?: boolean;
}

const AUDIO_POLL_INTERVAL_MS = 10_000;
const AUDIO_POLL_MAX_ATTEMPTS = 30;
// Audio is stitched shortly after a call ends. If a recording ended longer ago than
// the whole poll window and still has no audio, stitching is not pending — the
// recording simply has no playable audio, so we skip polling and mark it unavailable.
const AUDIO_STITCH_GRACE_MS = AUDIO_POLL_INTERVAL_MS * AUDIO_POLL_MAX_ATTEMPTS;

// A summary normally lands within minutes of the call ending. If the recording
// ended over an hour ago and detailedSummaryReady never flipped, the in-call
// attempt failed — stop implying progress and offer "Generate summary" instead.
const SUMMARY_PENDING_GRACE_MS = 60 * 60 * 1000;

const DEFAULT_SUMMARY_TEMPLATE_OPTION: RecordingSummaryTemplate = {
  id: 'default',
  name: 'Default summary',
  icon: '✨',
};

const POST_SPLIT_BUTTON_CLASS =
  'text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-background';

const CANVAS_POPOVER_LAYER_CLASS = '[&_[style*="--bn-ui-base-z-index"]]:!z-[15]';

function isRecordingLive(recording: RecordingDetail): boolean {
  return recording.status === 'ACTIVE' || recording.status === 'IN_PROGRESS';
}

function isSameRecordingSnapshot(a: RecordingDetail, b: RecordingDetail): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export default function RecordingDetailV2Screen(): ReactElement {
  const { isMobile } = usePlatform();
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedTab = useMemo(
    () => new URLSearchParams(location.search).get('tab'),
    [location.search],
  );
  const navState = location.state as RecordingNavState | null;
  const justStopped = navState?.justStopped === true;
  const stoppedAtMs = navState?.endedAtMs ?? null;
  const capturedTranscript =
    navState?.hasTranscript === true &&
    (stoppedAtMs === null || Date.now() - stoppedAtMs < NO_TRANSCRIPT_AFTER_MS);
  const currentUser = useSelf();
  const { summaryModelPreference, setSummaryModelPreference } = useSummaryModelPreference();

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  /** Why the recording couldn't be opened — classified, so the screen can say why. */
  const [failure, setFailure] = useState<RecordingLoadFailure | null>(null);

  if (recording && recording.externalId !== recordingId) {
    setRecording(null);
    setLoading(true);
    setFailure(null);
  }

  // Which of the two panes to show. The concrete second tab (transcript while live,
  // summary once ended) is derived below, so only the notes/not-notes choice is held.
  const [tabPreference, setTabPreference] = useState<RecordingV2Tab>(() =>
    requestedTab === 'notes' ? 'notes' : justStopped ? 'secondary' : getRecordingV2Tab(),
  );
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showPostToChannelModal, setShowPostToChannelModal] = useState(false);
  const [showPostToEmailModal, setShowPostToEmailModal] = useState(false);
  const [postToEmailNonce, setPostToEmailNonce] = useState(0);
  const [showGoogleDocPreviewModal, setShowGoogleDocPreviewModal] = useState(false);
  const [googleDocPreviewNonce, setGoogleDocPreviewNonce] = useState(0);
  const [isExportingGoogleDoc, setIsExportingGoogleDoc] = useState(false);
  const [templatesModalMode, setTemplatesModalMode] = useState<'browse' | 'new' | null>(null);
  const [shouldLoadSummaryTemplates, setShouldLoadSummaryTemplates] = useState(false);
  const { templates: summaryTemplates, isLoading: summaryTemplatesLoading } = useSummaryTemplates(
    shouldLoadSummaryTemplates || templatesModalMode !== null,
  );
  const storedSummaryTemplateId = recording?.summaryTemplateId ?? '';
  const shouldQueryStoredSummaryTemplate =
    storedSummaryTemplateId.length > 0 && storedSummaryTemplateId !== 'default';
  const [storedSummaryTemplate] = useCachedQuery(
    queries.summaryTemplateById({ templateId: storedSummaryTemplateId }),
    { enabled: shouldQueryStoredSummaryTemplate },
  );
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
  const [pendingSummaryTemplateId, setPendingSummaryTemplateId] = useState<string | null>(null);
  const [summaryCanvasNonce, setSummaryCanvasNonce] = useState(0);
  const [awaitingSummary, setAwaitingSummary] = useState(false);
  // Summary Generation panel states
  const [summaryRunNonce, setSummaryRunNonce] = useState(0);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [citationNonce, setCitationNonce] = useState(0);
  /** Set once the audio poll below gives up, so the player stops implying progress. */
  const [audioPollExhausted, setAudioPollExhausted] = useState(false);
  // Which line the transcript panel opens on: set by a timeline marker, null when the
  // panel is opened from the toolbar with no particular moment in mind.
  const [citationRef, setCitationRef] = useState<TranscriptPanelTarget | null>(null);
  // "Retry with …" footer popover: lets the owner regenerate this summary with
  // the other model tier, optionally making it their default going forward.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  useEffect(() => {
    if (requestedTab === 'notes') {
      setTabPreference('notes');
    }
  }, [recordingId, requestedTab]);

  const exportGoogleDoc = async (documentTitle?: string): Promise<void> => {
    if (!recording || isExportingGoogleDoc) return;

    // Opening synchronously keeps this user-initiated navigation from being blocked by browsers.
    const documentWindow = window.open('', '_blank');
    if (documentWindow) documentWindow.opener = null;

    setIsExportingGoogleDoc(true);
    try {
      const { documentUrl, document: createdDocument } = await recordingService.exportGoogleDoc(
        recording.externalId,
        documentTitle,
      );
      if (documentWindow) {
        documentWindow.location.assign(documentUrl);
      } else {
        window.open(documentUrl, '_blank', 'noopener,noreferrer');
      }
      // Zero replays the metadata write too, but only after the row round-trips —
      // the list should show the doc the moment its tab opens.
      if (createdDocument) {
        setRecording(prev =>
          prev
            ? {
                ...prev,
                googleDocs: [
                  createdDocument,
                  ...(prev.googleDocs ?? []).filter(
                    entry => entry.documentId !== createdDocument.documentId,
                  ),
                ],
              }
            : prev,
        );
      }
      toast.success('Google Doc created');
      setShowGoogleDocPreviewModal(false);
    } catch (error) {
      documentWindow?.close();
      toast.error('Failed to export to Google Docs', {
        description: axios.isAxiosError<{ error?: string }>(error)
          ? (error.response?.data?.error ?? error.message)
          : 'Please try again.',
      });
      throw error;
    } finally {
      setIsExportingGoogleDoc(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get('recordingEmailConnected') === 'true';
    const connectionError = params.get('recordingEmailError');
    if (!connected && !connectionError) return;

    if (connected) {
      toast.success('Google email connected');
      // Remount so the compose context is refetched — in Electron the modal is still
      // mounted from before the consent screen opened in the system browser.
      setPostToEmailNonce(nonce => nonce + 1);
      setShowPostToEmailModal(true);
    }
    if (connectionError) {
      toast.error(connectionError);
      setPostToEmailNonce(nonce => nonce + 1);
      setShowPostToEmailModal(true);
    }

    params.delete('recordingEmailConnected');
    params.delete('recordingEmailError');
    const search = params.toString();
    void navigate(
      { pathname: location.pathname, ...(search ? { search: `?${search}` } : {}) },
      { replace: true, state: location.state as RecordingNavState | null },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get('recordingGoogleDocConnected') === 'true';
    const connectionError = params.get('recordingGoogleDocError');
    if (!connected && !connectionError) return;

    if (connected) {
      toast.success('Google Docs connected');
      setGoogleDocPreviewNonce(nonce => nonce + 1);
      setShowGoogleDocPreviewModal(true);
    }
    if (connectionError) {
      toast.error('Google Docs connection failed. Please try again.');
      setShowGoogleDocPreviewModal(true);
    }
    params.delete('recordingGoogleDocConnected');
    params.delete('recordingGoogleDocError');
    const search = params.toString();
    void navigate(
      { pathname: location.pathname, ...(search ? { search: `?${search}` } : {}) },
      { replace: true, state: location.state as RecordingNavState | null },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  const activeRecordingId = useRecordingStore(context => context.externalId);
  const liveNotesCanvasId = useRecordingStore(context => context.notesCanvasId);
  // `canMark` is precisely "this tab is running this recording", which is also what
  // decides whether there is a floating overlay to minimize back to.
  const { markMoment, canMark: ownsLiveSession } = useMarkMoment(recordingId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadedRecordingIdRef = useRef<string | null>(null);

  // Stopping clears the local session at once, but the API keeps reporting the
  // recording live until the LiveKit webhook lands. Trusting the local stop makes the
  // screen change over in one step instead of twice, seconds apart.
  const [localSessionEnded, setLocalSessionEnded] = useState(justStopped);
  /** Which recording this tab was last running, so the edge below only fires for it. */
  const ownedLiveSessionRef = useRef<string | null>(null);
  // Tracks the live→ended edge, which is what moves the user onto the summary below.
  const wasLiveRef = useRef(false);

  if (ownsLiveSession && recordingId) {
    ownedLiveSessionRef.current = recordingId;
  } else if (!ownsLiveSession && ownedLiveSessionRef.current === recordingId) {
    ownedLiveSessionRef.current = null;
    setLocalSessionEnded(true);
  }

  const isLive = recording ? isRecordingLive(recording) && !localSessionEnded : false;

  // The ended layout is shorter than the transcript, so land at the top rather than
  // letting the browser clamp the scroll position as the page shrinks.
  useEffect(() => {
    if (localSessionEnded) scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [localSessionEnded]);

  // Set the default tab once per recording: an explicit `?tab=notes` deep link wins,
  // otherwise the remembered per-recording pane while it's live, or summary if it's
  // already ended on arrival (as opposed to watching it end live, which wasLiveRef
  // below handles).
  const initialTabRecordingIdRef = useRef<string | null>(null);
  if (recording && initialTabRecordingIdRef.current !== recordingId) {
    initialTabRecordingIdRef.current = recordingId ?? null;
    setTabPreference(
      requestedTab === 'notes'
        ? 'notes'
        : isLive
          ? getLiveRecordingV2Tab(recordingId)
          : 'secondary',
    );
  }

  // j/k keyboard navigation between recordings
  const recordingIds = navState?.recordingIds;
  const labelSuggestions = navState?.labelSuggestions ?? EMPTY_LABEL_SUGGESTIONS;
  const backTo = navState?.from ?? '/recordings';
  const currentIndex = useMemo(
    () => (recordingId ? (recordingIds?.indexOf(recordingId) ?? -1) : -1),
    [recordingId, recordingIds],
  );
  const canNavigateNext = currentIndex >= 0 && currentIndex < (recordingIds?.length ?? 0) - 1;
  const canNavigatePrevious = currentIndex > 0;

  const navigateRecording = useCallback(
    (delta: number) => {
      if (!recordingIds) return;
      const nextIdx = currentIndex + delta;
      const nextId = recordingIds[nextIdx];
      if (nextId) {
        void navigate(`/recordings/${nextId}`, { state: { recordingIds, labelSuggestions } });
      }
    },
    [recordingIds, labelSuggestions, currentIndex, navigate],
  );

  useShortcut('j', () => navigateRecording(1), {
    scope: 'global',
    description: 'Next recording',
    category: 'Recordings',
    enabled: canNavigateNext,
  });
  useShortcut('k', () => navigateRecording(-1), {
    scope: 'global',
    description: 'Previous recording',
    category: 'Recordings',
    enabled: canNavigatePrevious,
  });

  useEffect(() => {
    if (recordingId) void loadRecording(recordingId);
  }, [recordingId]);

  // The desktop app applies on-device speaker labels a few seconds after a
  // recording stops; refetch so the labelled transcript shows without a reload.
  useEffect(() => {
    if (!recordingId) return;
    const onLabelsApplied = (event: Event): void => {
      const detail = (event as CustomEvent<{ callId?: string }>).detail;
      if (detail?.callId === recordingId) void loadRecording(recordingId);
    };
    window.addEventListener(SPEAKER_LABELS_APPLIED_EVENT, onLabelsApplied);
    return (): void => window.removeEventListener(SPEAKER_LABELS_APPLIED_EVENT, onLabelsApplied);
  }, [recordingId]);

  // A summary asked for on a previous visit is still pending, so restore the skeleton.
  useEffect(() => {
    const request = getSummaryRequest(recordingId);
    setAwaitingSummary(request !== null);
    setPendingSummaryTemplateId(request?.templateId ?? null);
    if (request?.templateId) setShouldLoadSummaryTemplates(true);
    setSummaryFailed(false);
    setLocalSessionEnded(justStopped);
    if (justStopped) setTabPreference('secondary');
    ownedLiveSessionRef.current = null;
    wasLiveRef.current = false;
  }, [recordingId, justStopped]);

  /**
   * Ending the recording retires the transcript segment in favour of the summary
   */
  useEffect(() => {
    if (isLive) {
      wasLiveRef.current = true;
      return;
    }
    if (!wasLiveRef.current) return;
    wasLiveRef.current = false;
    setTabPreference('secondary');
  }, [isLive]);

  // Reactive metadata: everything here is a plain Call column (title, status,
  // labels, markedItems, summaryTemplateId, aiSummary text) so it's kept live
  // via Zero instead of only refreshing on the next full REST reload — e.g.
  // if labels/markedItems finish generating, or someone renames the
  // recording, while this screen is open. The transcript file content and
  // hasRecording flag still require the REST call below (not stored inline /
  // not Zero-synced).
  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recordingId ?? '' }),
    { enabled: !!recordingId },
  );

  const titleState = useRecordingTitleState({
    title: recordingRow ? recordingRow.title : (recording?.title ?? null),
    isEnded: !isLive,
    endedAtMs:
      recordingRow?.endedAt ?? (recording?.endedAt ? Date.parse(recording.endedAt) : stoppedAtMs),
    hasTranscript: capturedTranscript || !!recordingRow?.transcript || !!recording?.hasTranscript,
    hasSummary: !!recordingRow?.aiSummary || !!recording?.hasSummary,
  });

  useEffect(() => {
    if (!recordingRow || recordingRow.externalId !== recordingId) return;
    setRecording(prev => {
      const base: RecordingDetail = prev ?? {
        id: recordingRow.id,
        externalId: recordingRow.externalId,
        title: recordingRow.title ?? '',
        createdByUserId: recordingRow.createdByUserId,
        startedAt: new Date(recordingRow.startedAt).toISOString(),
        endedAt: null,
        durationMs: navState?.durationMs ?? null,
        hasTranscript: !!recordingRow.transcript,
        hasSummary: !!recordingRow.aiSummary,
        transcript: null,
        identifiedTranscript: null,
        hasIdentifiedTranscript: false,
        aiSummary: null,
        conversationId: null,
        channelId: recordingRow.channelId ?? null,
        messageId: null,
        notesCanvasId: null,
        detailedSummaryCanvasId: null,
        detailedSummaryReady: null,
        detailedSummaryStatus: null,
        summaryModelUsed: null,
        citationSegments: [],
      };
      const endedAt = recordingRow.endedAt ? new Date(recordingRow.endedAt).toISOString() : null;
      // Ticket linkage has no column of its own — it rides in Call.metadata,
      // the same place the notes canvas link lives. Keep the REST result live
      // when another client links or unlinks this recording.
      const metadata = recordingRow.metadata as Record<string, unknown> | null;
      const rawLinkedTicketId = metadata?.['linkedTicketId'];
      const linkedTicketId = typeof rawLinkedTicketId === 'string' ? rawLinkedTicketId : null;
      const rawLinkedTicketMessageId = metadata?.['linkedTicketMessageId'];
      const rawDetailedSummaryCanvasId = metadata?.['detailedSummaryCanvasId'];
      const rawDetailedSummaryReady = metadata?.['detailedSummaryReady'];
      const rawDetailedSummaryStatus = metadata?.['detailedSummaryStatus'];
      const rawNotesCanvasId = metadata?.['notesCanvasId'] ?? metadata?.['notesCanvasViewAccessId'];
      const googleDocs = parseRecordingGoogleDocLinks(metadata?.['googleDocs']);
      const rawSummaryModelUsed = metadata?.['summaryModelUsed'];
      const next: RecordingDetail = {
        ...base,
        title: recordingRow.title || base.title,
        labels: recordingRow.labels ?? base.labels,
        recordingParticipants: recordingRow.recordingParticipants ?? base.recordingParticipants,
        shares: recordingRow.shares ?? base.shares,
        linkedTicketId,
        linkedTicketMessageId:
          typeof rawLinkedTicketMessageId === 'string' ? rawLinkedTicketMessageId : null,
        detailedSummaryCanvasId:
          typeof rawDetailedSummaryCanvasId === 'string'
            ? rawDetailedSummaryCanvasId
            : base.detailedSummaryCanvasId,
        detailedSummaryReady:
          typeof rawDetailedSummaryReady === 'boolean'
            ? rawDetailedSummaryReady
            : base.detailedSummaryReady,
        detailedSummaryStatus:
          rawDetailedSummaryStatus === 'pending' ||
          rawDetailedSummaryStatus === 'ready' ||
          rawDetailedSummaryStatus === 'failed'
            ? rawDetailedSummaryStatus
            : base.detailedSummaryStatus,
        summaryModelUsed:
          rawSummaryModelUsed === 'fast' || rawSummaryModelUsed === 'thinking'
            ? rawSummaryModelUsed
            : base.summaryModelUsed,
        notesCanvasId:
          base.notesCanvasId ?? (typeof rawNotesCanvasId === 'string' ? rawNotesCanvasId : null),
        // An empty list here means metadata hasn't carried the key yet (older
        // recording, or the export write is still in flight) — keep what we have.
        googleDocs: googleDocs.length > 0 ? googleDocs : (base.googleDocs ?? []),
        markedItems: recordingRow.markedItems ?? base.markedItems,
        summaryTemplateId: recordingRow.summaryTemplateId ?? base.summaryTemplateId ?? null,
        aiSummary: recordingRow.aiSummary ?? base.aiSummary,
        hasSummary: !!recordingRow.aiSummary,
        endedAt,
        durationMs: endedAt
          ? new Date(endedAt).getTime() - new Date(recordingRow.startedAt).getTime()
          : base.durationMs,
      };
      if (recordingRow.status) {
        next.status = recordingRow.status as NonNullable<RecordingDetail['status']>;
      }
      return prev && isSameRecordingSnapshot(prev, next) ? prev : next;
    });
  }, [recordingRow, recordingId, recording?.externalId, navState?.durationMs]);

  useEffect(() => {
    const request = getSummaryRequest(recordingId);
    if (!request || recording?.externalId !== recordingId) return;
    // Prefer the explicit status when the backend has published it; the boolean
    // fallback keeps this working for recordings that predate the status field.
    const readyFromStatus = recording?.detailedSummaryStatus === 'ready';
    const hasExplicitSummaryStatus =
      recording?.detailedSummaryStatus === 'pending' ||
      recording?.detailedSummaryStatus === 'ready' ||
      recording?.detailedSummaryStatus === 'failed';
    const readyFromLegacyFlag = !hasExplicitSummaryStatus && !!recording?.detailedSummaryReady;
    const isReady = readyFromStatus || readyFromLegacyFlag;
    const requestedSummaryIsReady = request.templateId
      ? recording?.summaryTemplateId === request.templateId && isReady
      : isReady;
    // A 'failed' status is terminal too — drop the awaiting marker so the
    // shimmer stops and the "Generate again" offer surfaces. Without this,
    // an older marker (from a previous visit or a mount before the backend
    // published its status) would keep isAwaiting truthy, and the panel
    // internals `showFailed = hasFailed && !isAwaiting` would suppress the
    // failed view behind the shimmer.
    const isFailedTerminal = recording?.detailedSummaryStatus === 'failed';
    if (!requestedSummaryIsReady && !isFailedTerminal) return;
    setAwaitingSummary(false);
    setPendingSummaryTemplateId(null);
    clearSummaryRequested(recordingId);
    // A regeneration that reused the same canvas id won't remount via the
    // key — bump the nonce so the freshly-written content is refetched.
    if (requestedSummaryIsReady) {
      setSummaryCanvasNonce(value => value + 1);
    }
  }, [
    recording?.detailedSummaryReady,
    recording?.detailedSummaryStatus,
    recording?.externalId,
    recording?.summaryTemplateId,
    recordingId,
  ]);

  // The audio is stitched after the room closes, so `hasRecording` is still false for
  // a while once a recording ends — and it is REST-only, so nothing pushes it here.
  // Poll until it lands, which is what enables the player's controls.
  useEffect(() => {
    if (!recordingId || isLive || !recording || recording.hasRecording) return;

    // A recording that ended long ago and still has no audio is never going to get
    // one — mark playback unavailable immediately instead of polling for minutes.
    const endedAtMs = recording.endedAt ? new Date(recording.endedAt).getTime() : null;
    if (endedAtMs !== null && Date.now() - endedAtMs > AUDIO_STITCH_GRACE_MS) {
      setAudioPollExhausted(true);
      return;
    }

    setAudioPollExhausted(false);
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > AUDIO_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer);
        setAudioPollExhausted(true);
        return;
      }
      // Patch only the fields being polled for: a failed refresh must not tear down
      // the loaded screen, and Zero owns the rest.
      void recordingService
        .getRecordingDetail(recordingId)
        .then(fresh =>
          setRecording(current =>
            current
              ? {
                  ...current,
                  hasRecording: !!fresh.hasRecording,
                  durationMs: fresh.durationMs ?? current.durationMs,
                }
              : current,
          ),
        )
        .catch(() => undefined);
    }, AUDIO_POLL_INTERVAL_MS);

    return (): void => window.clearInterval(timer);
  }, [recordingId, isLive, recording?.hasRecording, recording?.endedAt]);

  const loadRecording = async (id: string): Promise<void> => {
    try {
      if (loadedRecordingIdRef.current !== id) setLoading(true);
      setFailure(null);
      const data = await recordingService.getRecordingDetail(id);
      loadedRecordingIdRef.current = id;
      setRecording(prev =>
        prev && data.durationMs === null && prev.durationMs !== null
          ? { ...data, durationMs: prev.durationMs }
          : data,
      );
    } catch (err) {
      logRecordingError('RecordingDetailV2Screen.loadRecording', err);
      const loadFailure = classifyRecordingLoadFailure(err);
      if (loadedRecordingIdRef.current === id) {
        toast.error('Couldn’t refresh this recording', {
          description: describeRecordingLoadFailure(loadFailure).title,
        });
      } else {
        setFailure(loadFailure);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMinimize = useCallback((): void => {
    sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: false });
    void navigate(backTo);
  }, [backTo, navigate]);

  /**
   * The panels differ wildly in height — a long transcript against a short notes
   * canvas — so switching while scrolled leaves the browser clamping the scroll
   * position as the page shrinks, which reads as the sticky bar lurching. Land at the
   * top instead, instantly: a smooth scroll here would race the tab animation.
   */
  const handleTabSelect = useCallback(
    (tab: 'notes' | 'summary' | 'transcript'): void => {
      const preference: RecordingV2Tab = tab === 'notes' ? 'notes' : 'secondary';
      setTabPreference(preference);
      if (isLive) setLiveRecordingV2Tab(recordingId, preference);
      else setRecordingV2Tab(preference);
      scrollContainerRef.current?.scrollTo({ top: 0 });
    },
    [isLive, recordingId],
  );

  const handleTitleUpdated = (title: string): void => {
    if (!recording) return;
    setRecording({ ...recording, title });
    // Keep the live overlay's header in step when renaming the in-progress recording.
    if (recording.externalId === activeRecordingId) {
      sendRecordingEvent({ type: 'setTitle', title });
    }
  };

  const handleLabelsUpdated = (labels: string[]): void => {
    setRecording(current => (current ? { ...current, labels } : current));
  };

  const handleTicketLinkUpdated = (ticketLink: RecordingTicketLinkState): void => {
    setRecording(current => (current ? { ...current, ...ticketLink } : current));
  };

  const handleRegenerateSummary = async (
    summaryTemplateId?: string,
    modelType?: 'fast' | 'thinking',
  ): Promise<void> => {
    if (!recording || isRegeneratingSummary) return;

    // Picking the template the existing summary was already written with is a no-op —
    // unless a specific model tier is being requested (e.g. "Try the thinking model").
    if (
      !modelType &&
      recording.detailedSummaryCanvasId &&
      recording.detailedSummaryReady !== false &&
      summaryTemplateId === recording.summaryTemplateId
    ) {
      handleTabSelect('summary');
      return;
    }

    const resolvedTemplateId = summaryTemplateId || recording.summaryTemplateId || 'default';
    handleTabSelect('summary');
    markSummaryRequested(recordingId, resolvedTemplateId);
    setSummaryRunNonce(value => value + 1);
    setAwaitingSummary(true);
    setSummaryFailed(false);
    setIsRegeneratingSummary(true);
    try {
      // The default template is code-backed and intentionally has no database row.
      setPendingSummaryTemplateId(resolvedTemplateId);
      // 202-only: the server continues generating after this resolves. The
      // shimmer stays up via awaitingSummary + the local 'pending' write
      // below, and the panel flips when the Zero-replicated
      // detailedSummaryStatus lands ('ready' clears the awaiting marker,
      // 'failed' surfaces "Try again"). Completion also raises an in-app
      // notification, so navigating away mid-generation is fine.
      await recordingService.regenerateSummary(recording.externalId, resolvedTemplateId, modelType);
      setRecording(current =>
        current
          ? {
              ...current,
              summaryTemplateId: resolvedTemplateId,
              detailedSummaryStatus: 'pending',
            }
          : current,
      );
      const selected = summaryTemplates.find(template => template.id === resolvedTemplateId);
      const selectedName =
        selected?.name ?? (resolvedTemplateId === 'default' ? 'Default' : 'Recording');
      toast.success(`Generating ${selectedName} summary`, {
        description: "We'll notify you when it's ready.",
      });
    } catch (err) {
      logRecordingError('RecordingDetailV2Screen.regenerateSummary', err);
      // Drop the placeholder too: a failed request leaves nothing on its way, and
      // leaving the mark set would restore the skeleton on the next visit.
      setAwaitingSummary(false);
      setPendingSummaryTemplateId(null);
      setSummaryFailed(true);
      clearSummaryRequested(recordingId);
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      toast.error('Failed to start summary generation', {
        description: message ?? 'Please try again.',
      });
    } finally {
      setIsRegeneratingSummary(false);
    }
  };

  /**
   * "Retry with …" footer actions: regenerate the current summary with the given
   * model tier. When `makeDefault` is set, also make that tier the user's default
   * for every future recording (otherwise their default is left unchanged).
   */
  const applyModel = async (target: 'fast' | 'thinking', makeDefault: boolean): Promise<void> => {
    if (!recording || isRegeneratingSummary) return;
    setModelMenuOpen(false);
    if (makeDefault) setSummaryModelPreference(target);
    const currentTemplateId = recording.summaryTemplateId ?? 'default';
    await handleRegenerateSummary(currentTemplateId, target);
  };

  const [message] = useCachedQuery(
    queries.getMessageForActivityV2({ messageId: recording?.messageId ?? '' }),
    { enabled: !!recording?.messageId },
  );

  // While live the notes canvas is created by NoteTakerOverlayHost, so its id only
  // reaches this screen through the store until the detail is refetched.
  const notesCanvasId =
    (isLive && recording?.externalId === activeRecordingId ? liveNotesCanvasId : null) ??
    recording?.notesCanvasId ??
    null;

  /**
   * A note-taker recording has no channel, message or conversation — it is created
   * from a LiveKit webhook rather than posted anywhere — so none of those can gate
   * opening Ask AI. Each is passed only when it exists, which is the case for a
   * channel call viewed on this screen; otherwise the panel opens unscoped, exactly
   * as the recordings list does.
   */
  const handleAskAI = useCallback((): void => {
    if (!recording) return;
    const attachmentIds = (message?.attachments ?? []).map((att: { id: string }) => att.id);
    const hasThreadContext = !!recording.conversationId || attachmentIds.length > 0;
    // Both canvases are attached with an explicit role: from the row alone the
    // agent cannot tell the machine-written summary from the user's own notes,
    // and it must weigh them differently.
    const canvasSelections = [
      ...(recording.detailedSummaryCanvasId
        ? [
            {
              id: recording.detailedSummaryCanvasId,
              canvasId: recording.detailedSummaryCanvasId,
              title: `${recording.title || 'Recording'} summary`,
              canvasRole: 'call-summary' as const,
            },
          ]
        : []),
      ...(notesCanvasId && notesCanvasId !== recording.detailedSummaryCanvasId
        ? [
            {
              id: notesCanvasId,
              canvasId: notesCanvasId,
              title: `${recording.title || 'Recording'} notes`,
              canvasRole: 'call-notes' as const,
            },
          ]
        : []),
    ];

    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
      contextType: 'general',
      initialContextSelections: {
        recordings: [
          {
            // `id` is the canonical Call id. `externalId` is only the public
            // recording-route id, so using it here would make Claw fail to
            // resolve the attached call.
            id: recording.id,
            title: recording.title || 'Recording',
            ...(recording.channelId ? { channelId: recording.channelId } : {}),
            ...(recording.conversationId ? { conversationId: recording.conversationId } : {}),
            externalId: recording.externalId,
          },
        ],
        canvases: canvasSelections,
      },
      threadInfo: hasThreadContext
        ? {
            conversationId: recording.conversationId ?? '',
            previewText: recording.title || 'Recording Transcript',
            ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
          }
        : null,
    });
  }, [recording, message, notesCanvasId]);

  const handleSummaryProgressPause = useCallback(
    (progress: number, stageIndex: number): void =>
      saveSummaryProgress(recordingId, progress, stageIndex),
    [recordingId],
  );

  // The backend only produces an identified transcript when speakers were
  // actually labelled (server voiceprints or the desktop app's on-device
  // diarization), so its presence is the only gate needed here.
  const transcriptText = recording?.hasIdentifiedTranscript
    ? (recording.identifiedTranscript ?? recording.transcript)
    : recording?.transcript;

  const markedMomentSeconds = useMemo(
    () =>
      parseMarkedItems(recording?.markedItems)
        .filter(item => item.type === 'moment')
        .map(item => item.timestampSeconds),
    [recording?.markedItems],
  );

  /**
   * Route canvas citations into this screen's own transcript panel instead of the
   * global TranscriptCitationModal, so clicking a citation behaves like the toolbar
   */
  useEffect(() => {
    if (!recordingId || !transcriptText?.trim()) return;
    return transcriptCitationStore.setHandler(ref => {
      if (ref.callId !== recordingId) return false;
      setCitationRef({
        ...(ref.timestamp ? { timestamp: ref.timestamp } : {}),
        ...(ref.speaker ? { speaker: ref.speaker } : {}),
        ...(ref.segment ? { segment: ref.segment } : {}),
      });
      setCitationNonce(value => value + 1);
      setShowTranscriptPanel(true);
      return true;
    });
  }, [recordingId, transcriptText]);

  // Seeds the summary-request record for the auto-detected pending state (server
  // summarizing without an explicit "Generate summary" click), so its progress
  // persists across unmounts the same way an explicit regenerate already does.
  useEffect(() => {
    if (!recordingId || recording?.externalId !== recordingId) return;
    if (awaitingSummary || summaryFailed) return;
    // If the backend has explicitly marked the status, trust it — a 'failed'
    // status must surface the retry offer immediately, and a 'pending' one is
    // already handled by the polling effect above.
    if (
      recording?.detailedSummaryStatus === 'failed' ||
      recording?.detailedSummaryStatus === 'pending'
    ) {
      return;
    }
    const hasDetailedSummaryNow =
      !!recording?.detailedSummaryCanvasId && recording?.detailedSummaryReady !== false;
    const hasTranscriptNow =
      !!transcriptText?.trim() || !!recordingRow?.transcript || !!recording?.hasTranscript;
    if (hasDetailedSummaryNow || !hasTranscriptNow) return;
    // An hour past the end with the summary still pending, generation is not
    // coming on its own — leave the request unset so the offer shows instead.
    const endedAtMs = recording?.endedAt ? Date.parse(recording.endedAt) : null;
    if (endedAtMs !== null && Date.now() - endedAtMs > SUMMARY_PENDING_GRACE_MS) return;
    if (getSummaryRequest(recordingId)) return;
    markSummaryRequested(recordingId);
  }, [recordingId, recording, recordingRow, transcriptText, awaitingSummary, summaryFailed]);

  if (loading && !recording) {
    return <RecordingDetailV2Skeleton />;
  }

  if (failure || !recording) {
    // Nothing loaded and nothing thrown can only mean the recording came back empty.
    const resolvedFailure: RecordingLoadFailure = failure ?? { kind: 'unknown' };
    return (
      <RecordingLoadError
        failure={resolvedFailure}
        viewerEmail={currentUser?.email}
        onBack={() => void navigate(backTo)}
      />
    );
  }

  // The player replaces the read-only timeline once there is audio to scrub.
  const showAudioPlayer = !isLive && !!recording.hasRecording;
  // Polling has given up (or was skipped for an old recording) and there is still no
  // stitched audio, so the control bar shows an unavailable indicator, not a spinner.
  const audioUnavailable = !isLive && !recording.hasRecording && audioPollExhausted;
  // The canvas itself now exists from call-start (so sharing works
  // immediately) — gate on detailedSummaryReady too, otherwise this would
  // flip true instantly and skip straight past the shimmer. `null` means the
  // recording predates this flag (already finished generating long ago), so
  // only an explicit `false` counts as "still generating".
  const hasDetailedSummary =
    !!recording.detailedSummaryCanvasId && recording.detailedSummaryReady !== false;
  const isOwner = recording.createdByUserId === currentUser?.id;
  const isGeneratingTitle = titleState?.kind === 'generating';
  // Sharing needs a summary canvas to share, and a live recording has nothing final yet.
  const canShare = !isLive && Boolean(recording.detailedSummaryCanvasId);
  const breadcrumbTitle =
    titleState && titleState.kind !== 'generating'
      ? titleState.text
      : resolveRecordingTitle(recording.title);
  const summaryTemplateOptions: RecordingSummaryTemplate[] = [
    DEFAULT_SUMMARY_TEMPLATE_OPTION,
    ...summaryTemplates
      .filter(template => template.id !== DEFAULT_SUMMARY_TEMPLATE_OPTION.id)
      .map(template => ({
        id: template.id,
        name: template.name,
        icon: getTemplateIcon(template.name),
      })),
  ];
  const selectedSummaryTemplateId = storedSummaryTemplateId;
  const regeneratingSummaryTemplateId =
    (pendingSummaryTemplateId ?? selectedSummaryTemplateId) || DEFAULT_SUMMARY_TEMPLATE_OPTION.id;
  const selectedSummaryTemplate: RecordingSummaryTemplate =
    summaryTemplateOptions.find(template => template.id === selectedSummaryTemplateId) ??
    (storedSummaryTemplate?.id === selectedSummaryTemplateId
      ? {
          id: storedSummaryTemplate.id,
          name: storedSummaryTemplate.name,
          icon: getTemplateIcon(storedSummaryTemplate.name),
        }
      : DEFAULT_SUMMARY_TEMPLATE_OPTION);

  const secondTab = isLive ? 'transcript' : 'summary';
  const visibleTab = tabPreference === 'notes' ? 'notes' : secondTab;

  // Nothing to summarize without a transcript, so the offer waits for one to exist.
  const hasTranscript =
    capturedTranscript ||
    !!transcriptText?.trim() ||
    !!recordingRow?.transcript ||
    !!recording.hasTranscript;

  // Single source of truth for what the panel/canvas region shows. Priority:
  // backend status → local UI state → legacy inference. The panel's
  // shimmer/failed/idle branches map directly off this state, which prevents
  // the "shimmer wins over failed" bug that comes from combining multiple
  // flags in the render tree.
  const summaryPanelState = deriveSummaryPanelState({
    recording,
    awaitingSummary,
    summaryFailed,
  });
  const showSummaryShimmer = summaryPanelState === 'pending';
  const summaryFailedEffective = summaryPanelState === 'failed';

  const handleMarkerSelect = (item: MarkedItem): void => {
    // A moment already announces itself in the transcript with a divider, so only
    // decisions and actions need the amber line highlight to be findable.
    setCitationRef({
      timestampSeconds: item.timestampSeconds,
      ...(item.type === 'moment' ? {} : { highlight: 'marker' as const }),
    });
    setCitationNonce(value => value + 1);
    setShowTranscriptPanel(true);
  };

  const openTranscriptPanel = (): void => {
    setCitationRef(null);
    setCitationNonce(value => value + 1);
    setShowTranscriptPanel(true);
  };

  // Only the toolbar icon button toggles — the waveform pill and "read transcript"
  // CTA should always open, never surprise-close, an already-open panel.
  const toggleTranscriptPanel = (): void => {
    if (showTranscriptPanel) {
      setShowTranscriptPanel(false);
      return;
    }
    openTranscriptPanel();
  };

  const handleOpenSummaryTemplates = (): void => {
    setShouldLoadSummaryTemplates(true);
    setTemplatesModalMode('browse');
  };

  const handleNewSummaryTemplate = (): void => {
    setShouldLoadSummaryTemplates(true);
    setTemplatesModalMode('new');
  };

  return (
    <div
      data-testid='recording-detail-v2-page'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      {/* Outside the scroller below, so it stays pinned. z-30 clears the sticky
          header's z-20 at widths where the centred column reaches the left edge. */}
      {!isMobile && (
        <div className='absolute left-0 top-0 z-30 hidden h-[52px] w-fit md:block'>
          <AppNavigator />
        </div>
      )}
      {/* layoutScroll: the tab indicator animates inside this scroller, so Motion has
          to account for its scroll offset when measuring positions. */}
      <motion.div
        ref={scrollContainerRef}
        layoutScroll
        className={[
          'h-full w-full overflow-y-scroll transition-[padding] duration-300',
          showTranscriptPanel ? 'md:pr-[560px]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className='mx-auto flex min-h-full w-full max-w-[860px] flex-col px-4 py-6'>
          {/* The only pinned row — the rest of the page scrolls under it. */}
          <div className='sticky top-0 z-20 -mx-4 -mt-6 flex items-center justify-between gap-3 bg-background px-4 pb-3 pt-6'>
            <nav aria-label='Breadcrumb' className='min-w-0'>
              <ol className='flex items-center gap-1.5 text-sm'>
                <li>
                  <button
                    type='button'
                    onClick={() => void navigate(backTo)}
                    className='flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground duration-300'
                    data-track-category='RecordingDetailV2'
                    data-track-name='breadcrumb_recordings'
                  >
                    Recordings
                  </button>
                </li>
                <li aria-hidden='true' className='text-muted-foreground'>
                  /
                </li>
                {/* Plain text here — the breadcrumb is a navigation label, not a status. */}
                <li className='truncate text-foreground'>
                  {isGeneratingTitle ? 'Generating title…' : breadcrumbTitle}
                </li>
              </ol>
            </nav>

            <div className='flex shrink-0 items-center gap-1'>
              {canShare && (
                <Tooltip content='Share' side='bottom'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    onClick={() => setShowShareModal(true)}
                    className='size-8 rounded-lg text-muted-foreground hover:text-foreground'
                    aria-label='Share recording'
                    data-track-category='RecordingDetailV2'
                    data-track-name='share_recording'
                  >
                    <Share02 className='size-4' />
                  </Button>
                </Tooltip>
              )}
              {!isLive && (
                <Tooltip content='Ask AI about this recording' side='bottom'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    onClick={handleAskAI}
                    className='size-8 rounded-lg text-muted-foreground hover:text-foreground'
                    aria-label='Ask AI about this recording'
                    data-track-category='RecordingDetailV2'
                    data-track-name='ask_ai_recording'
                  >
                    <XyneAIStar />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
          <RecordingDetailV2Header
            recording={recording}
            isLive={isLive}
            titleState={titleState}
            onTitleUpdated={handleTitleUpdated}
            onLabelsUpdated={handleLabelsUpdated}
            labelSuggestions={labelSuggestions}
            onTicketLinkUpdated={handleTicketLinkUpdated}
            onOpenShare={() => setShowShareModal(true)}
            {...(ownsLiveSession ? { onMinimize: handleMinimize } : {})}
          />
          <motion.div layoutRoot className='flex flex-col pt-2'>
            <LiveRecordingControlBar
              recording={recording}
              isLive={isLive}
              onStopped={() => void loadRecording(recording.externalId)}
              isAudioPreparing={!showAudioPlayer && !audioPollExhausted}
              isAudioUnavailable={audioUnavailable}
              {...(showAudioPlayer
                ? {
                    onLoadAudio: (signal: AbortSignal) =>
                      recordingService.downloadRecordingBlob(recording.externalId, signal),
                  }
                : {})}
              {...(transcriptText
                ? { onMarkerSelect: handleMarkerSelect, onOpenTranscript: openTranscriptPanel }
                : {})}
            />

            <div className='mb-4 flex items-center justify-between border-b border-border/70 pb-2'>
              {/* Templates are only offered once the recording has ended — while live
                  the second segment is the transcript and there is nothing to
                  regenerate from yet. */}
              <RecordingContentTabs
                visibleTab={visibleTab}
                secondTab={secondTab}
                onSelect={handleTabSelect}
                hasSummary={hasDetailedSummary}
                selectedTemplate={selectedSummaryTemplate}
                {...(isLive || !isOwner
                  ? {}
                  : {
                      // showSummaryShimmer covers both a click in this tab and a
                      // backend-published 'pending' (e.g. auto-generation after
                      // the call ended, or a regen started from another tab).
                      isRegenerating: isRegeneratingSummary || showSummaryShimmer,
                      regeneratingTemplateId: regeneratingSummaryTemplateId,
                      templates: summaryTemplateOptions,
                      templatesLoading: summaryTemplatesLoading,
                      onTemplateMenuOpen: () => setShouldLoadSummaryTemplates(true),
                      onTemplateSelect: summaryTemplateId =>
                        void handleRegenerateSummary(summaryTemplateId),
                      onRegenerate: () => void handleRegenerateSummary(selectedSummaryTemplate.id),
                      onOpenTemplates: handleOpenSummaryTemplates,
                      onNewTemplate: handleNewSummaryTemplate,
                    })}
              />

              {/* The right slot belongs to whichever action the state allows: flag a
                  moment while capturing, share the finished recording once ended. */}
              {isLive ? (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={markMoment}
                  disabled={!ownsLiveSession}
                  className='h-8 gap-2 rounded-full px-5 text-sm font-medium'
                  title={
                    ownsLiveSession
                      ? 'Mark this moment'
                      : 'Only the session running this recording can mark moments'
                  }
                  data-track-category='RecordingDetailV2'
                  data-track-name='mark_moment'
                >
                  <Flag size={15} strokeWidth={2.2} variant='Solid' aria-hidden='true' />
                  Mark this moment
                </Button>
              ) : isOwner && hasDetailedSummary ? (
                <DropdownMenu>
                  <div className='inline-flex h-8 items-stretch overflow-hidden rounded-lg bg-foreground text-background shadow-sm'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => setShowPostToChannelModal(true)}
                      className={`${POST_SPLIT_BUTTON_CLASS} text-xs font-semibold !rounded-2xl`}
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_channel_modal'
                    >
                      <Hashtag className='size-3.5' />
                      Post to channel
                    </Button>
                    <span className='my-1.5 w-px bg-muted-foreground/50' aria-hidden='true' />
                    <DropdownMenuTrigger asChild>
                      <Button
                        type='button'
                        variant='ghost'
                        size='iconSm'
                        aria-label='More actions'
                        className={POST_SPLIT_BUTTON_CLASS}
                        data-track-category='RecordingDetailV2'
                        data-track-name='open_recording_share_menu'
                      >
                        <ChevronDown className='size-3.5' />
                      </Button>
                    </DropdownMenuTrigger>
                  </div>
                  <DropdownMenuContent
                    align='end'
                    sideOffset={6}
                    className='w-60 rounded-xl p-1.5 shadow-xl'
                  >
                    <p className='px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                      Send this summary to
                    </p>
                    <DropdownMenuItem
                      onSelect={() => setShowPostToChannelModal(true)}
                      className='rounded-lg px-2.5 py-2'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_channel_from_menu'
                    >
                      <Hashtag className='size-4 text-muted-foreground' />
                      Post to channel
                      <span className='ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                        Default
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowPostToEmailModal(true)}
                      className='rounded-lg px-2.5 py-2'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_email_modal'
                    >
                      <EnvelopeDefault className='size-4 text-muted-foreground' />
                      Draft follow-up email
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowGoogleDocPreviewModal(true)}
                      disabled={isExportingGoogleDoc}
                      className='rounded-lg px-2.5 py-2'
                      data-track-category='RecordingDetailV2'
                      data-track-name='export_recording_google_doc'
                    >
                      <File02Text className='size-4 text-muted-foreground' />
                      {isExportingGoogleDoc ? 'Creating Google Doc…' : 'Export to Google Docs'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </motion.div>

          {visibleTab === 'notes' ? (
            /* flex-1 rather than a height: fills the pane on a short note without
                   pinning the scroll container, which is what sticky depends on. */
            <section className='mb-8 flex flex-1 flex-col'>
              {notesCanvasId ? (
                <NotesCanvas canvasId={notesCanvasId} />
              ) : (
                <div className='flex min-h-[280px] flex-col items-center justify-center gap-2 text-center'>
                  <StickyNote className='size-5 text-muted-foreground/60' aria-hidden='true' />
                  <p className='text-sm text-muted-foreground'>
                    {isLive ? 'Preparing notes…' : 'No notes yet for this recording.'}
                  </p>
                </div>
              )}
            </section>
          ) : visibleTab === 'transcript' ? (
            <LiveTranscriptSection recordingExternalId={recording.externalId} />
          ) : (
            <section className='mb-8 max-w-full'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2.5'>
                  <h2 className='text-lg font-semibold text-foreground'>Summary</h2>
                  {!hasDetailedSummary && !showSummaryShimmer && (
                    <span className='rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
                      Not generated
                    </span>
                  )}
                </div>
                {transcriptText ? (
                  <Tooltip
                    content={!showTranscriptPanel ? 'Open transcript' : 'Close transcript'}
                    side='left'
                  >
                    <Button
                      onClick={toggleTranscriptPanel}
                      variant='ghost'
                      className={cn(
                        'inline-flex size-8 items-center justify-center rounded-xl border border-border/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        showTranscriptPanel ? 'text-foreground' : 'text-muted-foreground',
                      )}
                      aria-label={!showTranscriptPanel ? 'Open transcript' : 'Close transcript'}
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_transcript_panel'
                    >
                      {showTranscriptPanel ? (
                        <SidebarRightClose className='size-4' aria-hidden='true' variant='Solid' />
                      ) : (
                        <SidebarRightOpen className='size-4' aria-hidden='true' variant='Solid' />
                      )}
                    </Button>
                  </Tooltip>
                ) : null}
              </div>
              {hasDetailedSummary ? (
                <>
                  <DetailedSummaryCanvas
                    key={`${recording.detailedSummaryCanvasId}:${summaryCanvasNonce}`}
                    canvasId={recording.detailedSummaryCanvasId!}
                  />
                  {/* Model footer (owner-only). Fast summaries offer an upgrade to
                      Thinking; Thinking summaries offer a downgrade to Fast. Each
                      "Retry with …" opens a popover to apply the tier to just this
                      summary or make it the default for future recordings. */}
                  {isOwner &&
                    (recording.summaryModelUsed === 'thinking' ? (
                      <div className='mt-5 flex items-center justify-between gap-2.5 border-t border-border pt-3'>
                        <span className='text-xs text-muted-foreground'>
                          Generated with a thinking model
                          {summaryModelPreference === 'thinking'
                            ? ' · default for future summaries'
                            : ''}
                        </span>
                        <div className='flex items-center gap-2.5'>
                          <span className='text-xs text-muted-foreground'>Want it faster?</span>
                          <Popover
                            open={modelMenuOpen}
                            onOpenChange={setModelMenuOpen}
                            side='top'
                            align='end'
                            sideOffset={8}
                            className='w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lg'
                            trigger={
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                disabled={isRegeneratingSummary}
                                title='Regenerate with Fast — single pass, ready in seconds'
                                className='h-7 gap-1.5 rounded-lg text-xs font-medium text-muted-foreground'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_with_fast'
                              >
                                <RefreshCw className='size-3.5' />
                                Retry with Fast
                              </Button>
                            }
                          >
                            <div>
                              <p className='px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                                Apply fast to
                              </p>
                              <button
                                type='button'
                                onClick={() => void applyModel('fast', false)}
                                className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_fast_once'
                              >
                                <p className='text-sm font-medium text-foreground'>
                                  Just this summary
                                </p>
                                <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                                  Regenerate once. Your default stays Thinking.
                                </p>
                              </button>
                              <button
                                type='button'
                                onClick={() => void applyModel('fast', true)}
                                className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_fast_always'
                              >
                                <p className='text-sm font-medium text-foreground'>
                                  All future summaries
                                </p>
                                <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                                  Make Fast the default for every call you capture.
                                </p>
                              </button>
                            </div>
                          </Popover>
                        </div>
                      </div>
                    ) : (
                      <div className='mt-5 flex items-center justify-between gap-2.5 border-t border-border pt-3'>
                        <span className='text-xs text-muted-foreground'>
                          Generated with a fast model
                          {summaryModelPreference === 'fast'
                            ? ' · default for future summaries'
                            : ''}
                        </span>
                        <div className='flex items-center gap-2.5'>
                          <span className='text-xs text-muted-foreground'>Not quite right?</span>
                          <Popover
                            open={modelMenuOpen}
                            onOpenChange={setModelMenuOpen}
                            side='top'
                            align='end'
                            sideOffset={8}
                            className='w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lg'
                            trigger={
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                disabled={isRegeneratingSummary}
                                title='Regenerate with Thinking — deeper pass, takes a little longer'
                                className='h-7 gap-1.5 rounded-lg text-xs font-medium text-muted-foreground'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_with_thinking'
                              >
                                <RefreshCw className='size-3.5' />
                                Retry with Thinking
                              </Button>
                            }
                          >
                            <div>
                              <p className='px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                                Apply thinking to
                              </p>
                              <button
                                type='button'
                                onClick={() => void applyModel('thinking', false)}
                                className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_thinking_once'
                              >
                                <p className='text-sm font-medium text-foreground'>
                                  Just this summary
                                </p>
                                <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                                  Regenerate once. Your default stays Fast.
                                </p>
                              </button>
                              <button
                                type='button'
                                onClick={() => void applyModel('thinking', true)}
                                className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
                                data-track-category='RecordingDetailV2'
                                data-track-name='retry_thinking_always'
                              >
                                <p className='text-sm font-medium text-foreground'>
                                  All future summaries
                                </p>
                                <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                                  Make Thinking the default for every call you capture.
                                </p>
                              </button>
                            </div>
                          </Popover>
                        </div>
                      </div>
                    ))}
                </>
              ) : (
                <SummaryGenerationPanel
                  isAwaiting={showSummaryShimmer}
                  canGenerate={hasTranscript}
                  onGenerate={() => void handleRegenerateSummary(selectedSummaryTemplate.id)}
                  onRetry={() => void handleRegenerateSummary(selectedSummaryTemplate.id)}
                  hasFailed={summaryFailedEffective}
                  generationRunId={summaryRunNonce}
                  initialProgress={getSummaryProgress(recordingId)}
                  initialStageIndex={getSummaryStage(recordingId)}
                  onProgressPause={handleSummaryProgressPause}
                  onReadTranscript={transcriptText ? openTranscriptPanel : undefined}
                />
              )}
              {/* Owner-only: the docs live in the owner's Drive, so these links are
                  dead ends for anyone the recording was merely shared with. */}
              {isOwner ? <RecordingGoogleDocsList documents={recording.googleDocs ?? []} /> : null}
            </section>
          )}
        </div>
      </motion.div>

      {/* Floats over the scroller, so it stays reachable at any scroll position. */}
      <ResumeRecordingButton recordingExternalId={recording.externalId} />

      {/* Transcript side panel */}
      <AnimatePresence>
        {showTranscriptPanel && transcriptText && (
          <TranscriptSidePanel
            transcript={transcriptText}
            showSpeakers={!!recording?.hasIdentifiedTranscript}
            target={citationRef}
            openNonce={citationNonce}
            markedTimestampsSeconds={markedMomentSeconds}
            onClose={() => {
              setShowTranscriptPanel(false);
              setCitationRef(null);
            }}
            className='absolute inset-y-0 right-0 z-30 w-full md:w-[560px]'
          />
        )}
      </AnimatePresence>

      {canShare && showShareModal && (
        <Dialog
          open={showShareModal}
          onOpenChange={open => !open && setShowShareModal(false)}
          title='Share recording'
          data-testid='recording-share-modal'
        >
          <RecordingShareModal
            recording={recording}
            onClose={() => setShowShareModal(false)}
            onTicketLinkUpdated={handleTicketLinkUpdated}
          />
        </Dialog>
      )}

      {isOwner && showPostToChannelModal && hasDetailedSummary && (
        <Dialog
          open={showPostToChannelModal}
          onOpenChange={open => !open && setShowPostToChannelModal(false)}
          title='Post to channel'
          data-testid='post-recording-to-channel-modal'
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <PostRecordingToChannelModal
            recording={recording}
            onClose={() => setShowPostToChannelModal(false)}
          />
        </Dialog>
      )}

      {isOwner && showPostToEmailModal && hasDetailedSummary && (
        <Dialog
          open={showPostToEmailModal}
          onOpenChange={open => !open && setShowPostToEmailModal(false)}
          title='Review draft email'
          description='Review the recording recap before sending it by email.'
          className='max-w-[1120px] overflow-hidden rounded-xl p-0'
          testId='post-recording-to-email-dialog'
        >
          <PostRecordingToEmailModal
            key={postToEmailNonce}
            recording={recording}
            onClose={() => setShowPostToEmailModal(false)}
          />
        </Dialog>
      )}

      {isOwner && showGoogleDocPreviewModal && hasDetailedSummary && (
        <Dialog
          open={showGoogleDocPreviewModal}
          onOpenChange={open => !open && setShowGoogleDocPreviewModal(false)}
          title='Preview Google Doc'
          description='Review the recording summary before creating a Google Doc.'
          className='max-w-[720px] overflow-hidden rounded-[18px] p-0'
          testId='google-doc-preview-dialog'
        >
          <GoogleDocPreviewModal
            key={googleDocPreviewNonce}
            recording={recording}
            onClose={() => setShowGoogleDocPreviewModal(false)}
            onExport={exportGoogleDoc}
            isExporting={isExportingGoogleDoc}
          />
        </Dialog>
      )}

      {isOwner && currentUser && templatesModalMode && (
        <Dialog
          open={templatesModalMode !== null}
          onOpenChange={open => !open && setTemplatesModalMode(null)}
          title='Summary Templates'
          description='Choose, create, edit, and share a recording summary template.'
          className='h-full max-h-[824px] w-full max-w-screen-lg overflow-hidden rounded-2xl p-0'
          testId='summary-templates-dialog'
        >
          <SummaryTemplatesModal
            templates={summaryTemplates}
            loading={summaryTemplatesLoading}
            selectedTemplateId={selectedSummaryTemplate.id || null}
            currentUserId={currentUser.id}
            currentUserName={getUserDisplayName(currentUser)}
            startWithNewTemplate={templatesModalMode === 'new'}
            onClose={() => setTemplatesModalMode(null)}
            onApply={template => handleRegenerateSummary(template.id)}
          />
        </Dialog>
      )}
    </div>
  );
}

function NotesCanvas({ canvasId }: { canvasId: string }): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: !!canvasId });
  const canvas = canvasData as unknown as Canvas | undefined;

  if (!canvas) {
    return (
      <div className='flex min-h-[260px] items-center justify-center'>
        <Spinner size={20} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  // The class overrides mirror the live NoteTakerOverlay's notes tab so the canvas
  // reads the same whether it is opened here or in the floating panel.
  return (
    <CollaborativeCanvasEditor
      key={canvas.id}
      canvasId={canvas.id}
      channelId={canvas.channelId || undefined}
      title={canvas.title}
      editable={true}
      placeholder='Add your notes here, you can view the transcript live in the transcript tab'
      className={`min-h-0 w-full flex-1 ${CANVAS_POPOVER_LAYER_CLASS}
        [&_.bn-side-menu]:!hidden
        [&_.thin-scrollbar]:!pt-2
        [&_.bn-editor]:!px-0
        [&_.bn-block-content:has(.ProseMirror-trailingBreak:only-child):after]:!text-base
        [&_.bn-suggestion-menu]:!w-auto [&_.bn-suggestion-menu]:!no-scrollbar [&_.bn-suggestion-menu]:!max-h-60 [&_.bn-suggestion-menu]:!max-w-[calc(100vw-2rem)]
        [&_.bn-suggestion-menu-item]:!h-8 [&_.bn-suggestion-menu-item]:!px-2 [&_.bn-suggestion-menu-item]:!py-1
        [&_.bn-mt-suggestion-menu-item-title]:!text-sm [&_.bn-mt-suggestion-menu-item-title]:!leading-4
        [&_.bn-mt-suggestion-menu-item-title]:!whitespace-nowrap [&_.bn-mt-suggestion-menu-item-title]:!overflow-hidden [&_.bn-mt-suggestion-menu-item-title]:!text-ellipsis
        [&_.bn-mt-suggestion-menu-item-section_svg]:!size-4
        `}
      autoFocus={true}
    />
  );
}

function DetailedSummaryCanvas({ canvasId }: { canvasId: string }): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: !!canvasId });
  const canvas = canvasData as unknown as Canvas | undefined;

  if (!canvas) {
    return (
      <div className='flex min-h-[260px] items-center justify-center'>
        <Spinner size={20} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  return (
    <CollaborativeCanvasEditor
      key={canvas.id}
      canvasId={canvas.id}
      channelId={canvas.channelId || undefined}
      title={canvas.title}
      editable={true}
      placeholder='Detailed summary'
      autoFocus={false}
      trackEditedRecordingSummaryBlocks={true}
      className={`w-full ${CANVAS_POPOVER_LAYER_CLASS}
        detailed-summary-canvas-editor
        [&_.bn-side-menu]:!hidden
        [&_.thin-scrollbar]:!pt-0
        [&_.bn-editor]:!px-0
        [&_.bn-block-content:has(.ProseMirror-trailingBreak:only-child):after]:!text-base
        [&_.bn-suggestion-menu]:!w-auto [&_.bn-suggestion-menu]:!no-scrollbar [&_.bn-suggestion-menu]:!max-h-60 [&_.bn-suggestion-menu]:!max-w-[calc(100vw-2rem)]
        [&_.bn-suggestion-menu-item]:!h-8 [&_.bn-suggestion-menu-item]:!px-2 [&_.bn-suggestion-menu-item]:!py-1
        [&_.bn-mt-suggestion-menu-item-title]:!text-sm [&_.bn-mt-suggestion-menu-item-title]:!leading-4
        [&_.bn-mt-suggestion-menu-item-title]:!whitespace-nowrap [&_.bn-mt-suggestion-menu-item-title]:!text-ellipsis
        [&_.bn-mt-suggestion-menu-item-section_svg]:!size-4
        `}
    />
  );
}
