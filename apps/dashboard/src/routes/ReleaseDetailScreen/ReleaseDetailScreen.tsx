/* eslint-disable local-rules/require-tracking-on-click */
import { Fragment, ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Boxes,
  Check,
  Download,
  FileText,
  GitMerge,
  Plus,
  RefreshCw,
  Rocket,
  Server,
  SquareArrowOutUpRight,
  TestTube,
  Ticket as TicketIcon,
} from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FormContextType, FormEntityType, type VCSProviderType } from '@xyne/shared';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../utils/apiError';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { useUsers } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { resolveDisplayFormFields } from '../../utils/board/resolveDisplayFormFields';
import { ChangeSections, type ChangeSectionsGroup } from '../../components/Release/ChangeCards';
import { RepoDot, repoColor, repoShortName } from '../../components/Release/repoVisual';
import { ReleaseStagePicker } from '../../components/Release/ReleaseStagePicker';
import { DevTicketStagePicker } from '../../components/Release/DevTicketStagePicker';
import { QAOwnerPicker } from '../../components/Release/QAOwnerPicker';
import {
  buildValuesByChangeId,
  buildGroupedByApp,
  buildStagesByBoard,
  filterGroupsByKind,
  buildChangeCountsByKey,
  type ChangeCounts,
} from '../../components/Release/releaseChanges.utils';
import { cn } from '../../utils/classNames';
import { Dialog } from '../../components/ui/Dialog';
import Textarea from '../../components/ui/Textarea';
import { useFailureReasonDialog } from './useFailureReasonDialog';
import {
  buildDevTicketsCsv,
  buildDevTicketsCsvFilename,
  buildReleaseDetailDevTicketRows,
  downloadCsvFile,
  devTicketAddableCellValue,
  groupDevTicketRowsByRepo,
  shortenRef,
  CORE_ADDABLE_DEV_TICKET_COLUMNS,
  type ReleaseDetailDevTicketRow,
} from './releaseReport.utils';
import { apiInstance } from '../../services/clients/apiClient';
import { CanvasPreview } from '../../components/Canvas/CanvasPreview/CanvasPreview';

type TabValue = 'testing' | 'envs' | 'migrations' | 'timeline' | 'releasenotes';

// Shape returned by GET /commits/analyze/repos/:releaseId. Mirrors the
// non_zero release_repositories row; structurally compatible with the
// RepoRangeInput the grouping util consumes.
type ReleaseRepositoryRow = {
  id: string;
  releaseId: string;
  mainReleaseBoardId: string;
  branch: string;
  deployedCommit: string;
  newCommit: string;
};

// Map ReleaseEventType (from shared schema) to icon + color for the timeline.
// Kept here (not exported) since the timeline is the only consumer right now.
const EVENT_VISUAL: Record<string, { icon: ReactElement; bg: string; ring: string }> = {
  RELEASE: {
    icon: <Rocket size={12} />,
    bg: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    ring: 'ring-purple-200 dark:ring-purple-800',
  },
  TICKET: {
    icon: <TicketIcon size={12} />,
    bg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    ring: 'ring-blue-200 dark:ring-blue-800',
  },
  SUBTICKET: {
    icon: <Boxes size={12} />,
    bg: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',
    ring: 'ring-cyan-200 dark:ring-cyan-800',
  },
  TESTING: {
    icon: <TestTube size={12} />,
    bg: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    ring: 'ring-amber-200 dark:ring-amber-800',
  },
  SYSTEM: {
    icon: <Server size={12} />,
    bg: 'bg-gray-200 dark:bg-gray-700/40 text-gray-700 dark:text-gray-300',
    ring: 'ring-gray-300 dark:ring-gray-700',
  },
  CANVAS: {
    icon: <FileText size={12} />,
    bg: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    ring: 'ring-green-200 dark:ring-green-800',
  },
};

const EVENT_FALLBACK = {
  icon: <GitMerge size={12} />,
  bg: 'bg-muted text-muted-foreground',
  ring: 'ring-border',
};

/** Short relative-time formatter for the timeline. Keeps the timeline scannable
 * without dragging in date-fns just for one screen. */
function formatRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 30 * 86_400) return `${Math.floor(diffSec / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Human-readable titles for the eventName values written by the backend.
// Falls back to title-casing the raw name for any we forgot to map.
const EVENT_TITLES: Record<string, string> = {
  COMMIT_ANALYSIS_STARTED: 'Analysis started',
  COMMIT_ANALYSIS_COMPLETED: 'Analysis complete',
  SUBTICKET_PROVISIONED: 'Application prepared',
  STAGE_CHANGED: 'Stage changed',
  FORM_SAVED: 'Form values saved',
  REPORT_PUBLISHED: 'Report published',
  REPORT_UPDATED: 'Report updated',
  MAPPING_WRITE_FAILED: 'Failed to write release mappings',
};
const humanizeEventName = (raw: string): string =>
  EVENT_TITLES[raw] ??
  raw
    .toLowerCase()
    .split('_')
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');

/** A timeline row — either a single event, or a stack of N identical-name
 * events that fired within a short window (e.g. four FORM_SAVED events from
 * one commit analysis run). Stacking collapses the visual noise without
 * hiding information. */
interface TimelineGroup {
  key: string;
  eventType: string;
  eventName: string;
  /** Most-recent timestamp from the group; what we display. */
  createdAt: number;
  /** All actor names found in the group (almost always one). */
  actors: string[];
  /** Each event's message body; rendered as a small list when count > 1. */
  messages: string[];
  count: number;
}

/**
 * Collapse consecutive events with the same eventType+eventName into one row.
 * Events further apart than `windowMs` aren't merged, so distinct release runs
 * stay visually separated even when they share an eventName.
 */
function groupTimelineEvents(
  events: ReadonlyArray<{
    id: string;
    eventType: string;
    eventName: string;
    message: string;
    userName: string | null;
    userId: string | null;
    createdAt: number;
  }>,
  windowMs = 5 * 60 * 1000,
): TimelineGroup[] {
  const out: TimelineGroup[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    const sameKind = last && last.eventType === ev.eventType && last.eventName === ev.eventName;
    const withinWindow = last && Math.abs(last.createdAt - ev.createdAt) <= windowMs;
    if (sameKind && withinWindow) {
      last.count++;
      last.messages.push(ev.message);
      const actor = ev.userName || (ev.userId ? 'a user' : 'system');
      if (!last.actors.includes(actor)) last.actors.push(actor);
      continue;
    }
    out.push({
      key: ev.id,
      eventType: ev.eventType,
      eventName: ev.eventName,
      createdAt: ev.createdAt,
      actors: [ev.userName || (ev.userId ? 'a user' : 'system')],
      messages: [ev.message],
      count: 1,
    });
  }
  return out;
}

// Page size for the Testing tab's ART (dev-ticket) table. CSV export bypasses
// this and fetches the whole release on demand.
const ART_PAGE_SIZE = 25;

// ─── ChangeCountBadge ─────────────────────────────────────────────────────────
const ChangeCountBadge = ({ counts }: { counts?: ChangeCounts | undefined }): ReactElement => {
  if (!counts || (counts.env === 0 && counts.mig === 0)) {
    return <span className='text-muted-foreground'>—</span>;
  }
  return (
    <span className='inline-flex items-center gap-1 text-xs'>
      {counts.env > 0 && (
        <span className='px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'>
          {counts.env} env
        </span>
      )}
      {counts.mig > 0 && (
        <span className='px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'>
          {counts.mig} mig
        </span>
      )}
    </span>
  );
};

// ─── Tab trigger helper ───────────────────────────────────────────────────────
const TabTrigger = ({
  value,
  activeTab,
  children,
}: {
  value: TabValue;
  activeTab: TabValue;
  children: React.ReactNode;
}): ReactElement => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 text-sm font-medium',
      activeTab === value ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground',
    )}
  >
    {children}
  </Tabs.Trigger>
);

const isTabValue = (value: unknown): value is TabValue =>
  value === 'testing' ||
  value === 'envs' ||
  value === 'migrations' ||
  value === 'timeline' ||
  value === 'releasenotes';

// ─── ReleaseDetailScreen ──────────────────────────────────────────────────────
const ReleaseDetailScreen = (): ReactElement => {
  const { projectId, releaseTicketId } = useParams<{
    projectId: string;
    releaseTicketId: string;
  }>();
  const zero = useZero();
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const location = useLocation();
  const routeTab = (location.state as { tab?: unknown } | null)?.tab;
  const initialTab = isTabValue(routeTab) ? routeTab : 'testing';
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);

  // ─── Testing-tab (ART) cursor pagination ─────────────────────────────────────
  // Stack of page-start cursors; entry i is the `start` for page i (page 0 = null).
  // Next pushes the last row's (createdAt, id); Prev pops. Reset when the release
  // changes (React Router may reuse this component across release ids).
  const [artCursorStack, setArtCursorStack] = useState<
    Array<{ createdAt: number; id: string } | null>
  >([null]);
  const artStart = artCursorStack[artCursorStack.length - 1] ?? null;
  const artPageIndex = artCursorStack.length - 1;

  // Export is an imperative full-release read rather than a cached subscription.
  // The request token prevents an old request from downloading or updating state
  // after navigation to another release.
  const [isExportingArt, setIsExportingArt] = useState(false);
  const exportRequestIdRef = useRef(0);
  const activeReleaseIdRef = useRef(releaseTicketId);
  activeReleaseIdRef.current = releaseTicketId;

  useEffect(() => {
    setArtCursorStack([null]);
    exportRequestIdRef.current += 1;
    setIsExportingArt(false);
  }, [releaseTicketId]);

  useEffect(
    () => () => {
      exportRequestIdRef.current += 1;
    },
    [],
  );

  const failureDialog = useFailureReasonDialog();

  // ─── Data fetching ──────────────────────────────────────────────────────────
  const [releaseTicket] = useCachedQuery(
    queries.ticketByIdV2({ ticketId: releaseTicketId ?? '' }),
    {
      enabled: !!releaseTicketId,
    },
  );
  const [releaseFormValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: releaseTicketId ?? '' }),
    { enabled: !!releaseTicketId },
  );
  // Added-column keys (persisted on the release ticket metadata). Read above the
  // ART query since they decide whether it syncs the heavy column relations.
  const persistedColumnKeys = useMemo(() => {
    const md = releaseTicket?.metadata;
    if (!md || typeof md !== 'object' || Array.isArray(md)) return [];
    const value = (md as Record<string, unknown>)['devTicketColumns'];
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
  }, [releaseTicket?.metadata]);

  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>([]);
  useEffect(() => {
    setSelectedColumnKeys(persistedColumnKeys);
  }, [persistedColumnKeys]);

  // Only widen the ART query when a relation-backed column is actually selected.
  const needsDevTicketColumnData = useMemo(
    () =>
      selectedColumnKeys.some(
        k => k === 'core:workflowType' || k === 'core:tags' || k.startsWith('custom:'),
      ),
    [selectedColumnKeys],
  );

  // Over-fetch one extra row (limit + 1) to detect whether a next page exists.
  const [artPage] = useCachedQuery(
    queries.applicationReleaseTicketsByReleaseId({
      releaseId: releaseTicketId ?? '',
      limit: ART_PAGE_SIZE + 1,
      start: artStart,
      includeColumnData: needsDevTicketColumnData,
    }),
    { enabled: !!releaseTicketId },
  );
  const artHasMore = (artPage?.length ?? 0) > ART_PAGE_SIZE;
  const artRows = useMemo(
    () => (artHasMore ? (artPage ?? []).slice(0, ART_PAGE_SIZE) : (artPage ?? [])),
    [artPage, artHasMore],
  );

  // release_repositories lives in the non_zero schema (server-only, not
  // Zero-replicated), so it's fetched over HTTP instead of synced via Zero.
  // Refetched after a re-run — the only in-screen action that changes these rows.
  const [releaseRepositories, setReleaseRepositories] = useState<ReleaseRepositoryRow[]>([]);
  const [analysisCanvasId, setAnalysisCanvasId] = useState<string | null>(null);
  const fetchReleaseRepositories = useCallback(async (): Promise<void> => {
    if (!releaseTicketId) {
      setReleaseRepositories([]);
      setAnalysisCanvasId(null);
      return;
    }
    // Discard a stale response if the active release changed mid-flight.
    const requestedReleaseId = releaseTicketId;
    try {
      const response = await apiInstance.get<{
        repos: ReleaseRepositoryRow[];
        analysisCanvasId?: string | null;
      }>(`/commits/analyze/repos/${releaseTicketId}`);
      if (activeReleaseIdRef.current !== requestedReleaseId) return;
      setReleaseRepositories(response.data?.repos ?? []);
      setAnalysisCanvasId(response.data?.analysisCanvasId ?? null);
    } catch {
      if (activeReleaseIdRef.current !== requestedReleaseId) return;
      setReleaseRepositories([]);
      setAnalysisCanvasId(null);
      toast.error('Could not load the repository breakdown for this release. Try refreshing.');
    }
  }, [releaseTicketId]);
  useEffect(() => {
    void fetchReleaseRepositories();
  }, [fetchReleaseRepositories]);
  const [applications] = useCachedQuery(
    queries.applicationsByProjectId({ projectId: projectId ?? '' }),
    { enabled: !!projectId },
  );
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: projectId ?? '' }), {
    enabled: !!projectId,
  });
  // repoUrl → stored vcsProvider (via the app's main release board) for the badge.
  const vcsProviderByRepoUrl = useMemo(() => {
    const byBoard = new Map((boards ?? []).map(b => [b.id, b.vcsProvider ?? null]));
    const map = new Map<string, VCSProviderType | null>();
    const apps = applications instanceof Error ? [] : (applications ?? []);
    for (const app of apps) {
      if (app.repoUrl && app.mainReleaseBoardId && !map.has(app.repoUrl)) {
        map.set(app.repoUrl, byBoard.get(app.mainReleaseBoardId) ?? null);
      }
    }
    return map;
  }, [applications, boards]);
  const [releaseChanges] = useCachedQuery(
    queries.releaseChangesByReleaseId({ releaseId: releaseTicketId ?? '' }),
    { enabled: !!releaseTicketId },
  );
  const [changeFormValues] = useCachedQuery(
    queries.releaseChangeFormValuesByReleaseId({ releaseId: releaseTicketId ?? '' }),
    { enabled: !!releaseTicketId },
  );
  // changeLog rows carry full migration diff bodies (multi-KB each) — only
  // sync them once the Migrations tab is opened.
  const [changeLogValues] = useCachedQuery(
    queries.releaseChangeLogValuesByReleaseId({ releaseId: releaseTicketId ?? '' }),
    { enabled: !!releaseTicketId && activeTab === 'migrations' },
  );
  const [stages] = useCachedQuery(queries.stagesByBoards({ projectId: projectId ?? '' }), {
    enabled: !!projectId,
  });
  // Timeline events — gated on the Timeline tab being open so we don't sync
  // potentially-large audit logs into the client until they're actually viewed.
  const [timelineEvents] = useCachedQuery(
    queries.releaseEventsByReleaseId({ releaseId: releaseTicketId ?? '', limit: 100 }),
    { enabled: !!releaseTicketId && activeTab === 'timeline' },
  );
  // The full workspace user list is already synced into client state at app
  // boot (InitialStateLoader → getUsersV2 → state machine), so reading it via
  // useUsers() is free — no extra per-viewer sync for the few referenced ids.
  const users = useUsers();

  // ─── Derived data ───────────────────────────────────────────────────────────
  const valuesByChangeId = useMemo(
    () => buildValuesByChangeId([...(changeFormValues ?? []), ...(changeLogValues ?? [])]),
    [changeFormValues, changeLogValues],
  );
  const releaseVersion = useMemo(() => {
    const value = releaseFormValues?.find(
      fv => fv.formField?.fieldName === 'releaseVersion',
    )?.actualFieldValue;

    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }, [releaseFormValues]);

  const groupedByApp = useMemo<ChangeSectionsGroup[]>(
    () => buildGroupedByApp(releaseChanges, vcsProviderByRepoUrl),
    [releaseChanges, vcsProviderByRepoUrl],
  );
  const envsByApp = useMemo(() => filterGroupsByKind(groupedByApp, 'ENV'), [groupedByApp]);
  const migrationsByApp = useMemo(
    () => filterGroupsByKind(groupedByApp, 'MIGRATION'),
    [groupedByApp],
  );

  // Tab badge: unique env var names across whole release. Reuses
  // buildChangeCountsByKey with a constant key so the env-counting rule stays
  // single-sourced with the per-row badges.
  const envChangeCount = useMemo(
    () =>
      buildChangeCountsByKey(releaseChanges, valuesByChangeId, () => 'all').get('all')?.env ?? 0,
    [releaseChanges, valuesByChangeId],
  );

  const migrationChangeCount = useMemo(
    () => migrationsByApp.reduce((sum, a) => sum + a.files.length, 0),
    [migrationsByApp],
  );

  // Per-dev-ticket change counts for badges.
  const changeCountsByDevTicket = useMemo(
    () => buildChangeCountsByKey(releaseChanges, valuesByChangeId, c => c.devTicketXyneId),
    [releaseChanges, valuesByChangeId],
  );
  const devTicketRows = useMemo(
    () => buildReleaseDetailDevTicketRows(artRows, users, changeCountsByDevTicket),
    [artRows, users, changeCountsByDevTicket],
  );

  // Grouping keeps one row per (ticket, app board) so a cross-repo ticket reaches
  // every repo group; the flat table/CSV use the one-row-per-ticket set above.
  const groupedDevTicketRows = useMemo(
    () =>
      buildReleaseDetailDevTicketRows(artRows, users, changeCountsByDevTicket, {
        dedupeBy: 'ticketAndBoard',
      }),
    [artRows, users, changeCountsByDevTicket],
  );

  const repoCount = releaseRepositories?.length ?? 0;
  const isMultiRepo = repoCount > 1;
  const devTicketRepoGroups = useMemo(
    () => groupDevTicketRowsByRepo(groupedDevTicketRows, releaseRepositories, applications),
    [groupedDevTicketRows, releaseRepositories, applications],
  );

  // Per-board stage lists for release status controls.
  const stagesByBoard = useMemo(() => {
    return buildStagesByBoard(stages);
  }, [stages]);

  // Re-run commit analysis for this release. Hits the existing backend endpoint
  // which loads the release ticket's deployedCommitId / newCommitId / branch
  // from form values, then dispatches the same analysis pipeline as create.
  const [isReRunning, setIsReRunning] = useState(false);
  const handleReRunAnalysis = async (): Promise<void> => {
    if (!releaseTicketId) return;
    setIsReRunning(true);
    try {
      const response = await apiInstance.post<{ success: boolean; error?: string }>(
        `/commits/analyze/re-run/${releaseTicketId}`,
        {},
      );
      if (response.data?.success) {
        void fetchReleaseRepositories();
        toast.success('Commit analysis re-run — check the conversation for the new summary.');
      } else {
        toast.error(response.data?.error ?? 'Re-run failed');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Re-run failed'));
    } finally {
      setIsReRunning(false);
    }
  };

  // ─── Add-column picker: dev tickets' board fields (core + custom) ────────────
  // Custom columns are sourced from the boards the dev tickets live on (not the
  // release board), so a field defined there is both editable on each ticket and
  // matched by the same field id when rendered here. A release may aggregate dev
  // tickets from several boards, so we union the custom fields across every
  // distinct board. Cells for a field a given ticket's board lacks render '—'.
  const devTicketBoardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of devTicketRows) if (row.boardId) ids.add(row.boardId);
    return [...ids].sort();
  }, [devTicketRows]);

  const [devColsMappings] = useCachedQuery(
    queries.getFormMappingsByContextIds({
      contextIds: devTicketBoardIds,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: devTicketBoardIds.length > 0 },
  );

  const availableColumns = useMemo(() => {
    // Dedupe by column key so a field shared across boards appears once.
    const custom = new Map<string, { key: string; label: string }>();
    for (const mapping of devColsMappings ?? []) {
      for (const field of resolveDisplayFormFields(
        mapping.formId ?? '',
        mapping.formFields ? [...mapping.formFields] : [],
      )) {
        const key = `custom:${field.id}`;
        if (!custom.has(key)) custom.set(key, { key, label: field.fieldName });
      }
    }
    return [...CORE_ADDABLE_DEV_TICKET_COLUMNS, ...custom.values()];
  }, [devColsMappings]);

  // Drops any stale key whose field no longer exists on the board and keeps a
  // stable order (core first, then custom).
  const selectedColumns = useMemo(
    () => availableColumns.filter(col => selectedColumnKeys.includes(col.key)),
    [availableColumns, selectedColumnKeys],
  );

  if (!projectId || !releaseTicketId) {
    return <div className='p-6'>Missing route params</div>;
  }

  const releaseLabel = releaseTicket?.xyneId
    ? `${releaseTicket.xyneId} · ${releaseTicket.title || 'Release ticket'}`
    : releaseTicket?.title || 'Release';

  const returnToUrl = (location.state as { returnToUrl?: string } | null)?.returnToUrl;
  const releaseTicketChannelId = (releaseTicket as { channelId?: string | null } | undefined)
    ?.channelId;
  const releaseTicketConversationId = (
    releaseTicket as { conversationId?: string | null } | undefined
  )?.conversationId;
  const canGoToTicket =
    !!returnToUrl || !!(releaseTicketChannelId && releaseTicketConversationId);
  const goToReleaseTicket = (): void => {
    if (returnToUrl && /^\/(?![/\\])/.test(returnToUrl)) {
      void navigate(returnToUrl);
      return;
    }
    if (releaseTicketChannelId && releaseTicketConversationId && releaseTicketId) {
      void navigate(
        `${baseRoute}/${releaseTicketChannelId}/${releaseTicketConversationId}/${releaseTicketId}?selectedTab=details`,
      );
    }
  };

  const exportDevTickets = async (): Promise<void> => {
    if (isExportingArt) return;

    const requestedReleaseId = releaseTicketId;
    const requestId = ++exportRequestIdRef.current;
    setIsExportingArt(true);

    try {
      const exportArtRows = await zero.run(
        queries.applicationReleaseTicketsByReleaseId({
          releaseId: requestedReleaseId,
          includeColumnData: needsDevTicketColumnData,
        }),
        { type: 'complete' },
      );

      if (
        exportRequestIdRef.current !== requestId ||
        activeReleaseIdRef.current !== requestedReleaseId
      ) {
        return;
      }

      const rows = buildReleaseDetailDevTicketRows(exportArtRows, users, changeCountsByDevTicket);
      downloadCsvFile(
        buildDevTicketsCsv(rows, selectedColumns),
        buildDevTicketsCsvFilename(releaseTicket?.xyneId, releaseVersion),
      );
    } catch {
      if (
        exportRequestIdRef.current === requestId &&
        activeReleaseIdRef.current === requestedReleaseId
      ) {
        toast.error('Failed to export release tickets. Please try again.');
      }
    } finally {
      if (
        exportRequestIdRef.current === requestId &&
        activeReleaseIdRef.current === requestedReleaseId
      ) {
        setIsExportingArt(false);
      }
    }
  };

  const toggleColumn = (key: string, checked: boolean): void => {
    const nextKeys = checked
      ? [...selectedColumnKeys, key]
      : selectedColumnKeys.filter(k => k !== key);
    setSelectedColumnKeys(nextKeys);

    const md = releaseTicket?.metadata;
    const base =
      md && typeof md === 'object' && !Array.isArray(md) ? (md as Record<string, unknown>) : {};
    void (async (): Promise<void> => {
      const res = await zero.mutate(
        mutators.ticket.update({
          id: releaseTicketId,
          metadata: { ...base, devTicketColumns: nextKeys },
          updatedAt: Date.now(),
        }),
      ).server;
      if (res.type === 'error') {
        toast.error('Failed to save columns');
      }
    })();
  };

  const goPrevArtPage = (): void =>
    setArtCursorStack(stack => (stack.length > 1 ? stack.slice(0, -1) : stack));

  const goNextArtPage = (): void => {
    if (!artHasMore) return;
    const last = artRows[artRows.length - 1];
    if (last) setArtCursorStack(stack => [...stack, { createdAt: last.createdAt, id: last.id }]);
  };

  const devTicketColCount = 8 + selectedColumns.length;

  const renderDevTicketRow = (row: ReleaseDetailDevTicketRow): ReactElement => (
    <tr key={row.internalTicketId} className='border-t border-border'>
      <td className='sticky left-0 z-10 w-[110px] bg-background px-4 py-2 font-mono text-xs'>
        {row.internalTicketId && row.channelId && row.conversationId ? (
          <button
            className='text-primary hover:underline cursor-pointer'
            onClick={() =>
              void navigate(
                `${baseRoute}/${row.channelId}/${row.conversationId}/${row.internalTicketId}?selectedTab=details`,
              )
            }
            data-track-category='Release'
            data-track-name='OPEN_RELEASE_CONVERSATION'
          >
            {row.ticketId}
          </button>
        ) : (
          <span className='text-muted-foreground'>{row.ticketId}</span>
        )}
      </td>
      <td
        title={row.title}
        className='sticky left-[110px] z-10 min-w-[220px] max-w-[320px] truncate border-r border-border bg-background px-4 py-2'
      >
        {row.title}
      </td>
      <td className='px-4 py-2'>
        {row.prId && row.prUrl ? (
          <a
            href={row.prUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary hover:underline'
          >
            #{row.prId}
          </a>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </td>
      <td className='px-4 py-2 text-muted-foreground'>{row.devOwner}</td>
      <td className='px-4 py-2'>
        <div className='flex items-center gap-1.5'>
          <span className='text-xs px-2 py-0.5 rounded bg-muted'>{row.type}</span>
          {row.isHotfix && (
            <span className='text-xs px-2 py-0.5 rounded font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'>
              🔥 Hotfix
            </span>
          )}
        </div>
      </td>
      <td className='px-4 py-2'>
        <DevTicketStagePicker
          ticketId={row.internalTicketId}
          stageName={row.status}
          stages={row.boardId ? (stagesByBoard.get(row.boardId) ?? []) : []}
          artId={row.artId}
          onCancelled={stage =>
            failureDialog.openFor(row.artId, row.title, stage, row.failureReason ?? '')
          }
        />
      </td>
      <td className='px-4 py-2 text-xs'>
        <ChangeCountBadge counts={row.changeCounts} />
      </td>
      <td className='px-4 py-2'>
        <QAOwnerPicker
          artId={row.artId}
          testedBy={row.testedBy}
          currentUserName={row.testedBy ? row.qaOwner : null}
        />
      </td>
      {selectedColumns.map(col => (
        <td
          key={col.key}
          title={devTicketAddableCellValue(row, col.key)}
          className='min-w-[120px] max-w-[240px] truncate px-4 py-2 text-muted-foreground'
        >
          {devTicketAddableCellValue(row, col.key)}
        </td>
      ))}
    </tr>
  );

  const renderRepoHeaderRow = (
    key: string,
    dotKey: string,
    label: string,
    rangeFrom: string | null,
    rangeTo: string | null,
    tested: number | null,
    total: number,
  ): ReactElement => (
    <tr key={`repo-${key}`} className='border-t border-border bg-muted/50'>
      <td colSpan={devTicketColCount} className='sticky left-0 z-10 bg-muted/50 px-4 py-2'>
        <div className='flex items-center gap-2.5'>
          <RepoDot color={repoColor(dotKey)} />
          <span className='text-sm font-semibold text-foreground'>{label}</span>
          {(rangeFrom || rangeTo) && (
            <span className='rounded-md bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground'>
              {shortenRef(rangeFrom) || '—'}
              <span className='mx-0.5'>→</span>
              {shortenRef(rangeTo) || '—'}
            </span>
          )}
          {tested !== null && (
            <span className='ml-auto rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
              TESTED {tested}/{total}
            </span>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className='h-full bg-muted flex flex-col'>
      <div className='flex-1 overflow-auto p-8'>
        <div className='max-w-none'>
          <button
            onClick={() =>
              void navigate(`/listProjects/${projectId}`, {
                // 'releases' = the Releases list in release-manager mode ('release' is Repositories).
                state: { tab: 'releases', from: 'releaseManager' },
              })
            }
            data-track-category='Release'
            data-track-name='BACK_TO_PROJECT_RELEASES'
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors'
          >
            <ArrowLeft size={20} />
            <span>Back to Releases</span>
          </button>

          <div className='bg-background rounded-lg shadow-sm border border-border p-6 space-y-6'>
            {/* Header */}
            <div className='flex items-start justify-between gap-4'>
              <h1 className='text-2xl font-bold text-foreground'>{releaseLabel}</h1>
              <div className='flex items-center gap-2 shrink-0'>
                {canGoToTicket && (
                  <button
                    type='button'
                    onClick={goToReleaseTicket}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='Release'
                    data-track-name='GoToReleaseTicket'
                    data-testid='go-to-release-ticket'
                    className='inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors'
                    title='Open the release ticket in its channel'
                  >
                    <TicketIcon size={15} />
                    Go to ticket
                  </button>
                )}
                <button
                  type='button'
                  onClick={() => {
                    const w = window.open(window.location.href, '_blank');
                    w?.focus();
                  }}
                  data-track-category='Release'
                  data-track-name='OPEN_RELEASE_IN_NEW_WINDOW'
                  className='p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                  title='Open in new window'
                  aria-label='Open in new window'
                >
                  <SquareArrowOutUpRight size={16} />
                </button>
              </div>
            </div>

            {releaseTicket && (
              <div className='flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
                <span className='flex items-center gap-1.5'>
                  Status:
                  <ReleaseStagePicker
                    ticketId={releaseTicket.id}
                    stageName={releaseTicket.stageName}
                    boardId={releaseTicket.boardId}
                    stages={stagesByBoard.get(releaseTicket.boardId) ?? []}
                  />
                </span>
                {releaseVersion && (
                  <span className='px-2 py-0.5 rounded bg-muted text-foreground'>
                    Version: {releaseVersion}
                  </span>
                )}
                <span>· Created {new Date(releaseTicket.createdAt).toLocaleString()}</span>
                {isMultiRepo && <span>· {repoCount} repositories</span>}
              </div>
            )}

            {/* Tabs */}
            <Tabs.Root value={activeTab} onValueChange={v => setActiveTab(v as TabValue)}>
              <Tabs.List className='inline-flex border-b border-border'>
                <TabTrigger value='testing' activeTab={activeTab}>
                  Dev Tickets
                </TabTrigger>
                <TabTrigger value='envs' activeTab={activeTab}>
                  Envs
                  {envChangeCount > 0 && (
                    <span className='ml-2 text-xs px-1.5 py-0.5 rounded bg-muted'>
                      {envChangeCount}
                    </span>
                  )}
                </TabTrigger>
                <TabTrigger value='migrations' activeTab={activeTab}>
                  Migrations
                  {migrationChangeCount > 0 && (
                    <span className='ml-2 text-xs px-1.5 py-0.5 rounded bg-muted'>
                      {migrationChangeCount}
                    </span>
                  )}
                </TabTrigger>
                <TabTrigger value='timeline' activeTab={activeTab}>
                  Timeline
                </TabTrigger>
                <TabTrigger value='releasenotes' activeTab={activeTab}>
                  Release notes
                </TabTrigger>
              </Tabs.List>

              {/* Dev Tickets tab */}
              <Tabs.Content value='testing' className='mt-6 outline-none'>
                <div className='mb-3 flex flex-wrap justify-end gap-2'>
                  {availableColumns.length > 0 && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type='button'
                          data-testid='release-dev-tickets-add-column'
                          className='inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted'
                        >
                          <Plus size={15} />
                          Add column
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align='end'
                          sideOffset={4}
                          className='z-50 max-h-80 min-w-[200px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-md'
                        >
                          {CORE_ADDABLE_DEV_TICKET_COLUMNS.map(col => {
                            const checked = selectedColumnKeys.includes(col.key);
                            return (
                              <DropdownMenu.CheckboxItem
                                key={col.key}
                                checked={checked}
                                onCheckedChange={value => toggleColumn(col.key, value)}
                                onSelect={e => e.preventDefault()}
                                className='flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted'
                              >
                                <span>{col.label}</span>
                                <span
                                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                                    checked
                                      ? 'border-primary bg-primary'
                                      : 'border-input bg-background'
                                  }`}
                                >
                                  {checked && (
                                    <Check size={12} className='text-primary-foreground' />
                                  )}
                                </span>
                              </DropdownMenu.CheckboxItem>
                            );
                          })}
                          {availableColumns.length > CORE_ADDABLE_DEV_TICKET_COLUMNS.length && (
                            <>
                              <DropdownMenu.Separator className='my-1 h-px bg-border' />
                              <div className='px-3 py-1.5 text-xs font-medium text-muted-foreground'>
                                Custom Fields
                              </div>
                              {availableColumns
                                .filter(col => col.key.startsWith('custom:'))
                                .map(col => {
                                  const checked = selectedColumnKeys.includes(col.key);
                                  return (
                                    <DropdownMenu.CheckboxItem
                                      key={col.key}
                                      checked={checked}
                                      onCheckedChange={value => toggleColumn(col.key, value)}
                                      onSelect={e => e.preventDefault()}
                                      className='flex cursor-pointer items-center justify-between gap-3 rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-muted'
                                    >
                                      <span>{col.label}</span>
                                      <span
                                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                                          checked
                                            ? 'border-primary bg-primary'
                                            : 'border-input bg-background'
                                        }`}
                                      >
                                        {checked && (
                                          <Check size={12} className='text-primary-foreground' />
                                        )}
                                      </span>
                                    </DropdownMenu.CheckboxItem>
                                  );
                                })}
                            </>
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                  <button
                    type='button'
                    onClick={() => void handleReRunAnalysis()}
                    disabled={isReRunning || !releaseTicketId}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='Release'
                    data-track-name='ReRunCommitAnalysis'
                    data-track-metadata={JSON.stringify({ releaseTicketId })}
                    data-testid='rerun-commit-analysis'
                    title='Re-run commit analysis with the current release configuration — useful after fixing Application regex / paths.'
                    className='inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <RefreshCw size={15} className={isReRunning ? 'animate-spin' : ''} />
                    {isReRunning ? 'Re-running…' : 'Re-run Analysis'}
                  </button>
                  <button
                    type='button'
                    onClick={() => void exportDevTickets()}
                    disabled={isExportingArt || (artRows.length === 0 && artPageIndex === 0)}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='Release'
                    data-track-name='ExportReleaseDevTicketsCsv'
                    data-track-metadata={JSON.stringify({
                      releaseTicketId,
                      devTicketCount: devTicketRows.length,
                    })}
                    data-testid='export-release-dev-tickets-csv'
                    className='inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <Download size={15} />
                    {isExportingArt ? 'Preparing…' : 'Export as CSV'}
                  </button>
                </div>
                {!artRows || artRows.length === 0 ? (
                  <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
                    <p className='text-sm text-muted-foreground'>
                      No ART rows yet. They are created during commit analysis when a release
                      deploys.
                    </p>
                  </div>
                ) : (
                  <div className='thin-scrollbar overflow-x-auto rounded-lg border border-border'>
                    <table className='w-max min-w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap'>
                      <thead className='bg-muted text-left'>
                        <tr>
                          <th className='sticky left-0 z-10 w-[110px] bg-muted px-4 py-2 font-medium'>
                            Ticket Id
                          </th>
                          <th className='sticky left-[110px] z-10 min-w-[220px] border-r border-border bg-muted px-4 py-2 font-medium'>
                            Title
                          </th>
                          <th className='px-4 py-2 font-medium'>PR</th>
                          <th className='px-4 py-2 font-medium'>Dev Owner</th>
                          <th className='px-4 py-2 font-medium'>Type</th>
                          <th className='px-4 py-2 font-medium min-w-[160px]'>Status</th>
                          <th className='px-4 py-2 font-medium'>Changes</th>
                          <th className='px-4 py-2 font-medium'>QA Owner</th>
                          {selectedColumns.map(col => (
                            <th key={col.key} className='min-w-[120px] px-4 py-2 font-medium'>
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {isMultiRepo ? (
                          <>
                            {devTicketRepoGroups.groups.map(group => (
                              <Fragment key={group.key}>
                                {renderRepoHeaderRow(
                                  group.key,
                                  group.key || group.repoUrl || '',
                                  group.repoUrl
                                    ? repoShortName(group.repoUrl)
                                    : group.fallbackName || 'Repository',
                                  group.rangeFrom,
                                  group.rangeTo,
                                  group.testedCount,
                                  group.totalCount,
                                )}
                                {group.rows.map(renderDevTicketRow)}
                              </Fragment>
                            ))}
                            {devTicketRepoGroups.unmapped.length > 0 && (
                              <Fragment key='__unmapped'>
                                {renderRepoHeaderRow(
                                  '__unmapped',
                                  '',
                                  'Other',
                                  null,
                                  null,
                                  null,
                                  devTicketRepoGroups.unmapped.length,
                                )}
                                {devTicketRepoGroups.unmapped.map(renderDevTicketRow)}
                              </Fragment>
                            )}
                          </>
                        ) : (
                          devTicketRows.map(renderDevTicketRow)
                        )}
                      </tbody>
                    </table>
                    {(artHasMore || artPageIndex > 0) && (
                      <div className='flex items-center justify-end gap-3 border-t border-border px-4 py-2 text-sm'>
                        <span className='text-xs text-muted-foreground'>
                          Page {artPageIndex + 1}
                        </span>
                        <button
                          type='button'
                          onClick={goPrevArtPage}
                          data-track-category='Release'
                          data-track-name='ARTIFACTS_PREV_PAGE'
                          disabled={artPageIndex === 0}
                          className='rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          Previous
                        </button>
                        <button
                          type='button'
                          onClick={goNextArtPage}
                          data-track-category='Release'
                          data-track-name='ARTIFACTS_NEXT_PAGE'
                          disabled={!artHasMore}
                          className='rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value='envs' className='mt-6 outline-none space-y-6'>
                <ChangeSections
                  groups={envsByApp}
                  kind='ENV'
                  emptyMessage='No env changes recorded for this release yet.'
                  valuesByChangeId={valuesByChangeId}
                />
              </Tabs.Content>

              <Tabs.Content value='migrations' className='mt-6 outline-none space-y-6'>
                <ChangeSections
                  groups={migrationsByApp}
                  kind='MIGRATION'
                  emptyMessage='No migration changes recorded for this release yet.'
                  valuesByChangeId={valuesByChangeId}
                />
              </Tabs.Content>

              {/* Timeline tab — audit log of everything that happened on this
                  release (commit analyses, SubTicket creation, env/migration
                  captures, system events, canvas publishes). */}
              <Tabs.Content value='timeline' className='mt-6 outline-none'>
                {!timelineEvents || timelineEvents.length === 0 ? (
                  <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
                    <p className='text-sm text-muted-foreground'>
                      No events yet. The timeline fills up as commit analysis runs and the release
                      progresses through stages.
                    </p>
                  </div>
                ) : (
                  <ol className='relative border-l border-border ml-3 space-y-3'>
                    {groupTimelineEvents([...timelineEvents]).map(g => {
                      const visual = EVENT_VISUAL[g.eventType] ?? EVENT_FALLBACK;
                      const absoluteTime = new Date(g.createdAt).toLocaleString();
                      const actor = g.actors.join(', ');
                      const uniqueMessages = Array.from(new Set(g.messages.filter(Boolean)));
                      return (
                        <li key={g.key} className='ml-6'>
                          <span
                            className={cn(
                              'absolute -left-[11px] flex items-center justify-center w-[22px] h-[22px] rounded-full ring-4 ring-background',
                              visual.bg,
                            )}
                          >
                            {visual.icon}
                          </span>
                          <div className='flex items-baseline justify-between gap-3'>
                            <div className='flex items-baseline gap-2 min-w-0'>
                              <span className='text-sm font-medium text-foreground truncate'>
                                {humanizeEventName(g.eventName)}
                              </span>
                              {g.count > 1 && (
                                <span
                                  className='text-[11px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full'
                                  title={`${g.count} occurrences in a short window`}
                                >
                                  ×{g.count}
                                </span>
                              )}
                            </div>
                            <span
                              className='text-xs text-muted-foreground shrink-0 whitespace-nowrap'
                              title={`${absoluteTime} · by ${actor}`}
                            >
                              {formatRelativeTime(g.createdAt)}
                            </span>
                          </div>
                          {uniqueMessages.length > 0 && (
                            <div className='mt-0.5 text-sm text-muted-foreground space-y-0.5'>
                              {uniqueMessages.map((m, i) => (
                                <p key={i} className='whitespace-pre-wrap break-words'>
                                  {m}
                                </p>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Tabs.Content>

              <Tabs.Content value='releasenotes' className='mt-6 outline-none'>
                {analysisCanvasId ? (
                  <CanvasPreview canvasId={analysisCanvasId} expanded />
                ) : (
                  <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
                    <p className='text-sm text-muted-foreground'>
                      No release notes yet. They appear here once commit analysis has run for
                      this release — use “Re-run Analysis” on the Dev Tickets tab to generate them.
                    </p>
                  </div>
                )}
              </Tabs.Content>
            </Tabs.Root>
          </div>
        </div>
      </div>

      {/* Failure Reason Dialog */}
      <Dialog
        open={failureDialog.state.isOpen}
        onOpenChange={failureDialog.close}
        title='Mark as Failed'
        description={`Add a failure reason for: ${failureDialog.state.artTitle}`}
      >
        <div className='space-y-4 p-4'>
          <Textarea
            placeholder='Describe why this ticket failed QA / testing...'
            value={failureDialog.state.failureReason}
            onChange={e => failureDialog.setFailureReason(e.target.value)}
            rows={4}
          />
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className='px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors'
              onClick={failureDialog.close}
              data-track-category='Release'
              data-track-name='CLOSE_FAILURE_DIALOG'
            >
              Cancel
            </button>
            <button
              type='button'
              className='px-3 py-1.5 text-sm rounded bg-destructive text-white hover:bg-destructive/80 transition-colors disabled:opacity-50'
              disabled={
                !failureDialog.state.failureReason.trim() || failureDialog.state.isSubmitting
              }
              onClick={() => void failureDialog.submit()}
              data-track-category='Release'
              data-track-name='SUBMIT_FAILURE_DIALOG'
            >
              {failureDialog.state.isSubmitting ? 'Saving...' : 'Submit'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default ReleaseDetailScreen;
