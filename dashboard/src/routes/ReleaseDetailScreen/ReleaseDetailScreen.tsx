/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Download, FileText, SquareArrowOutUpRight } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { toast } from 'sonner';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { useUsers } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { queries } from '../../zero/queries';
import { ChangeSections, type ChangeSectionsGroup } from '../../components/Release/ChangeCards';
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
} from './releaseReport.utils';
import { usePublishReleaseReport } from './usePublishReleaseReport';

type TabValue = 'testing' | 'envs' | 'migrations';

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
  value === 'testing' || value === 'envs' || value === 'migrations';

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
  // Over-fetch one extra row (limit + 1) to detect whether a next page exists.
  const [artPage] = useCachedQuery(
    queries.applicationReleaseTicketsByReleaseId({
      releaseId: releaseTicketId ?? '',
      limit: ART_PAGE_SIZE + 1,
      start: artStart,
    }),
    { enabled: !!releaseTicketId },
  );
  const artHasMore = (artPage?.length ?? 0) > ART_PAGE_SIZE;
  const artRows = useMemo(
    () => (artHasMore ? (artPage ?? []).slice(0, ART_PAGE_SIZE) : (artPage ?? [])),
    [artPage, artHasMore],
  );

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
    () => buildGroupedByApp(releaseChanges),
    [releaseChanges],
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

  // Per-board stage lists for release status controls.
  const stagesByBoard = useMemo(() => {
    return buildStagesByBoard(stages);
  }, [stages]);

  const existingReportCanvasUrl = useMemo(() => {
    const metadata = releaseTicket?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = (metadata as Record<string, unknown>)['releaseReportCanvasUrl'];
    return typeof value === 'string' && value ? value : null;
  }, [releaseTicket?.metadata]);
  const {
    isPublishing: isPublishingReport,
    hasPublished: hasPublishedReport,
    publish: publishReport,
  } = usePublishReleaseReport(releaseTicketId, existingReportCanvasUrl);

  if (!projectId || !releaseTicketId) {
    return <div className='p-6'>Missing route params</div>;
  }

  const releaseLabel = releaseTicket?.xyneId
    ? `${releaseTicket.xyneId} · ${releaseTicket.title || 'Release ticket'}`
    : releaseTicket?.title || 'Release';

  const exportDevTickets = async (): Promise<void> => {
    if (isExportingArt) return;

    const requestedReleaseId = releaseTicketId;
    const requestId = ++exportRequestIdRef.current;
    setIsExportingArt(true);

    try {
      const exportArtRows = await zero.run(
        queries.applicationReleaseTicketsByReleaseId({ releaseId: requestedReleaseId }),
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
        buildDevTicketsCsv(rows),
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

  const goPrevArtPage = (): void =>
    setArtCursorStack(stack => (stack.length > 1 ? stack.slice(0, -1) : stack));

  const goNextArtPage = (): void => {
    if (!artHasMore) return;
    const last = artRows[artRows.length - 1];
    if (last) setArtCursorStack(stack => [...stack, { createdAt: last.createdAt, id: last.id }]);
  };

  return (
    <div className='h-full bg-muted flex flex-col'>
      <div className='flex-1 overflow-auto p-8'>
        <div className='max-w-7xl mx-auto'>
          <button
            onClick={() =>
              void navigate(`/listProjects/${projectId}`, { state: { tab: 'release' } })
            }
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors'
          >
            <ArrowLeft size={20} />
            <span>Back to Releases</span>
          </button>

          <div className='bg-background rounded-lg shadow-sm border border-border p-6 space-y-6'>
            {/* Header */}
            <div className='flex items-start justify-between gap-4'>
              <h1 className='text-2xl font-bold text-foreground'>{releaseLabel}</h1>
              <button
                type='button'
                onClick={() => {
                  const w = window.open(window.location.href, '_blank');
                  w?.focus();
                }}
                className='shrink-0 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
                title='Open in new window'
                aria-label='Open in new window'
              >
                <SquareArrowOutUpRight size={16} />
              </button>
            </div>

            {releaseTicket && (
              <div className='flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
                <span className='flex items-center gap-1.5'>
                  Status:
                  <ReleaseStagePicker
                    ticketId={releaseTicket.id}
                    stageName={releaseTicket.stageName}
                    stages={stagesByBoard.get(releaseTicket.boardId) ?? []}
                  />
                </span>
                {releaseVersion && (
                  <span className='px-2 py-0.5 rounded bg-muted text-foreground'>
                    Version: {releaseVersion}
                  </span>
                )}
                <span>· Created {new Date(releaseTicket.createdAt).toLocaleString()}</span>
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
              </Tabs.List>

              {/* Dev Tickets tab */}
              <Tabs.Content value='testing' className='mt-6 outline-none'>
                <div className='mb-3 flex flex-wrap justify-end gap-2'>
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
                  <button
                    type='button'
                    onClick={() => void publishReport()}
                    disabled={!releaseTicket || isPublishingReport}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='Release'
                    data-track-name={
                      hasPublishedReport ? 'UpdateReleaseReport' : 'PublishReleaseReport'
                    }
                    data-track-metadata={JSON.stringify({
                      releaseTicketId,
                      devTicketCount: devTicketRows.length,
                      environmentVariableCount: envChangeCount,
                      migrationFileCount: migrationChangeCount,
                    })}
                    data-testid='publish-release-report'
                    className='inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <FileText size={15} />
                    {isPublishingReport
                      ? hasPublishedReport
                        ? 'Updating...'
                        : 'Publishing...'
                      : hasPublishedReport
                        ? 'Update Report'
                        : 'Publish Report'}
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
                  <div className='border border-border rounded-lg overflow-hidden'>
                    <table className='w-full text-sm'>
                      <thead className='bg-muted text-left'>
                        <tr>
                          <th className='px-4 py-2 font-medium'>Ticket Id</th>
                          <th className='px-4 py-2 font-medium'>Title</th>
                          <th className='px-4 py-2 font-medium'>PR</th>
                          <th className='px-4 py-2 font-medium'>Dev Owner</th>
                          <th className='px-4 py-2 font-medium'>Type</th>
                          <th className='px-4 py-2 font-medium min-w-[160px]'>Status</th>
                          <th className='px-4 py-2 font-medium'>Changes</th>
                          <th className='px-4 py-2 font-medium'>QA Owner</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devTicketRows.map(row => {
                          return (
                            <tr key={row.internalTicketId} className='border-t border-border'>
                              <td className='px-4 py-2 font-mono text-xs'>
                                {row.internalTicketId && row.channelId && row.conversationId ? (
                                  <button
                                    className='text-primary hover:underline cursor-pointer'
                                    onClick={() =>
                                      void navigate(
                                        `${baseRoute}/${row.channelId}/${row.conversationId}/${row.internalTicketId}?selectedTab=details`,
                                      )
                                    }
                                  >
                                    {row.ticketId}
                                  </button>
                                ) : (
                                  <span className='text-muted-foreground'>{row.ticketId}</span>
                                )}
                              </td>
                              <td className='px-4 py-2'>{row.title}</td>
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
                                <span className='text-xs px-2 py-0.5 rounded bg-muted'>
                                  {row.type}
                                </span>
                              </td>
                              <td className='px-4 py-2'>
                                <DevTicketStagePicker
                                  ticketId={row.internalTicketId}
                                  stageName={row.status}
                                  stages={row.boardId ? (stagesByBoard.get(row.boardId) ?? []) : []}
                                  artId={row.artId}
                                  onCancelled={stage =>
                                    failureDialog.openFor(
                                      row.artId,
                                      row.title,
                                      stage,
                                      row.failureReason ?? '',
                                    )
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
                            </tr>
                          );
                        })}
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
                          disabled={artPageIndex === 0}
                          className='rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        >
                          Previous
                        </button>
                        <button
                          type='button'
                          onClick={goNextArtPage}
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
