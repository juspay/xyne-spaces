import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { BoardType } from '@xyne/shared';
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge/Badge';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { apiInstance } from '../../../services/clients/apiClient';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { StageRemapTable } from './StageRemapTable';
import type {
  ApiEnvelope,
  CopyCategorySelection,
  ExecuteCopyResponse,
  ExecuteCopySummary,
  JobStatusResponse,
  PlanCopyResult,
} from './BoardConfigCopyScreen.types';

interface BoardConfigCopyScreenProps {
  targetBoardId: string;
  targetBoardName?: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}

type Step = 'select' | 'remap' | 'progress' | 'result';

const POLL_INTERVAL_MS = 2000;

const extractErrorMessage = (error: unknown, fallback: string): string => {
  const withResponse = error as {
    response?: { data?: { error?: string | { message?: string }; message?: string } };
  };
  const data = withResponse?.response?.data;
  if (typeof data?.error === 'string') return data.error;
  if (data?.error && typeof data.error === 'object' && data.error.message)
    return data.error.message;
  if (data?.message) return data.message;
  if (error instanceof Error) return error.message;
  return fallback;
};

const BoardConfigCopyScreen = ({
  targetBoardId,
  targetBoardName,
  projectId,
  isOpen,
  onClose,
  onDone,
}: BoardConfigCopyScreenProps): ReactElement | null => {
  const zero = useZero();
  void zero; // reserved: this screen only talks to the backend via REST, not Zero mutators
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const [projectBoards] = useCachedQuery(
    queries.boardsListByProject({ projectId: projectId || '' }),
    {
      enabled: !!projectId,
    },
  );

  const [step, setStep] = useState<Step>('select');
  const [sourceBoardId, setSourceBoardId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CopyCategorySelection>({
    customFields: true,
    roles: true,
    stages: true,
  });

  const [plan, setPlan] = useState<PlanCopyResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [remapOverrides, setRemapOverrides] = useState<Record<string, string>>({});

  const [executing, setExecuting] = useState(false);
  const [, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [summary, setSummary] = useState<ExecuteCopySummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  // A completed/failed job from a PRIOR run, found on mount — surfaced as a dismissible
  // banner on the select step rather than forcing the admin into the result screen every
  // time they reopen this board's copy-config modal (jobId is deterministic per target
  // board, so that job stays queryable until the next run overwrites it).
  const [previousJobStatus, setPreviousJobStatus] = useState<JobStatusResponse | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const sourceOptions: SelectorOption[] = useMemo(
    () =>
      (projectBoards ?? [])
        .filter(board => board.id !== targetBoardId && board.boardType !== BoardType.RELEASE)
        .map(board => ({ value: board.id, label: board.name, icon: null })),
    [projectBoards, targetBoardId],
  );

  const resetForClose = (): void => {
    stopPolling();
    setStep('select');
    setSourceBoardId(null);
    setCategories({ customFields: true, roles: true, stages: true });
    setPlan(null);
    setPlanError(null);
    setRemapOverrides({});
    setExecuting(false);
    setJobId(null);
    setJobStatus(null);
    setSummary(null);
    setResultError(null);
    setPreviousJobStatus(null);
  };

  const handleClose = (): void => {
    resetForClose();
    onClose();
  };

  const fetchPlan = useCallback(async (): Promise<PlanCopyResult | null> => {
    if (!sourceBoardId) return null;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const response = await apiInstance.post<ApiEnvelope<PlanCopyResult>>(
        '/admin/board-config-copy/plan',
        { sourceBoardId, targetBoardId, categories },
      );
      const result = response.data.data;
      if (!result) {
        setPlanError(response.data.error ?? 'Failed to load copy plan');
        return null;
      }
      setPlan(result);
      if (result.errors.length > 0) {
        setPlanError(result.errors.join(' '));
      }
      const seeded: Record<string, string> = { ...(result.suggestedMapping ?? {}) };
      setRemapOverrides(prev => ({ ...seeded, ...prev }));
      return result;
    } catch (error) {
      // Validation failures (e.g. mismatched project) come back as HTTP 400 with the
      // PlanCopyResult still attached under `data.data` — surface it if present so the
      // UI can show the structured `errors` list, not just a generic message.
      const withResponse = error as {
        response?: { data?: ApiEnvelope<PlanCopyResult> };
      };
      const attached = withResponse?.response?.data?.data;
      if (attached) {
        setPlan(attached);
        setPlanError(
          attached.errors.join(' ') || extractErrorMessage(error, 'Failed to load copy plan'),
        );
        return attached;
      }
      const message = extractErrorMessage(error, 'Failed to load copy plan');
      setPlanError(message);
      return null;
    } finally {
      setPlanLoading(false);
    }
  }, [sourceBoardId, targetBoardId, categories]);

  const handleContinueFromSelect = async (): Promise<void> => {
    if (!sourceBoardId) {
      toast.error('Select a source board first');
      return;
    }
    if (!categories.customFields && !categories.roles && !categories.stages) {
      toast.error('Select at least one category to copy');
      return;
    }
    if (!categories.stages) {
      await runExecute();
      return;
    }

    const result = await fetchPlan();
    if (!result || result.errors.length > 0) return;

    const hasTicketsToRemap = (result.oldStages ?? []).some(stage => stage.ticketCount > 0);
    if (hasTicketsToRemap) {
      setStep('remap');
    } else {
      await runExecute();
    }
  };

  const visibleRemapRows = useMemo(() => {
    if (!plan) return [];
    return (plan.oldStages ?? []).filter(stage => stage.ticketCount > 0);
  }, [plan]);

  const newStageOptions = useMemo(
    () =>
      (plan?.newStages ?? []).map(stage => ({
        // `sourceStageId` (not a real, not-yet-created stage id) is what the backend uses to
        // key `suggestedMapping`/`requiresExplicit` and expects back in `StageRemapOverride.newStageId`.
        id: stage.sourceStageId,
        name: stage.name,
        defaultStatus: stage.defaultTicketStatusV2,
      })),
    [plan],
  );

  const remapComplete = useMemo(
    () => visibleRemapRows.every(row => Boolean(remapOverrides[row.id])),
    [visibleRemapRows, remapOverrides],
  );

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      const poll = async (): Promise<void> => {
        try {
          const response = await apiInstance.get<ApiEnvelope<JobStatusResponse>>(
            `/admin/board-config-copy/status/${id}`,
          );
          const status = response.data.data;
          if (!status) throw new Error(response.data.error ?? 'Failed to fetch job status');
          setJobStatus(status);
          if (status.state === 'completed') {
            stopPolling();
            setSummary(status.result ?? null);
            setStep('result');
            toast.success('Board configuration copy completed');
          } else if (status.state === 'failed') {
            stopPolling();
            setSummary(null);
            setResultError(status.failedReason ?? 'The copy job failed');
            setStep('result');
            toast.error('Board configuration copy failed');
          }
        } catch (error) {
          stopPolling();
          setSummary(null);
          setResultError(extractErrorMessage(error, 'Lost track of the copy job status'));
          setStep('result');
        }
      };
      pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  const runExecute = async (overrides?: Record<string, string>): Promise<void> => {
    const confirmed = await confirm({
      title: 'Copy board configuration?',
      description: categories.stages
        ? 'This will copy the selected configuration and remap any affected tickets onto the new stages. This cannot be undone automatically.'
        : 'This will copy the selected configuration onto the target board. This cannot be undone automatically.',
      confirmLabel: 'Copy configuration',
    });
    if (!confirmed) return;

    setExecuting(true);
    setResultError(null);
    // Clear any stale summary/job-status carried over from viewing a PRIOR run's result
    // within this same still-mounted session (e.g. via the "View details" banner) — a
    // fresh run must never render leftover numbers from a different job.
    setSummary(null);
    setJobStatus(null);
    setPreviousJobStatus(null);
    try {
      const stageRemapOverrides = categories.stages
        ? Object.entries(overrides ?? remapOverrides).map(([oldStageId, newStageId]) => ({
            oldStageId,
            newStageId,
          }))
        : undefined;

      const response = await apiInstance.post<ApiEnvelope<ExecuteCopyResponse>>(
        '/admin/board-config-copy/execute',
        {
          sourceBoardId,
          targetBoardId,
          categories,
          ...(categories.stages && { stageRemapOverrides }),
          dryRun: false,
        },
      );

      const result = response.data.data;
      if (result?.jobId) {
        setJobId(result.jobId);
        setStep('progress');
        startPolling(result.jobId);
      } else if (result?.summary) {
        setSummary(result.summary);
        setStep('result');
        toast.success('Board configuration copied');
      } else {
        throw new Error(response.data.error ?? 'Copy did not return a result');
      }
    } catch (error) {
      const message = extractErrorMessage(error, 'Failed to copy board configuration');
      toast.error('Copy failed', { description: message, duration: 5000 });
      setResultError(message);
    } finally {
      setExecuting(false);
    }
  };

  const handleContinueFromRemap = async (): Promise<void> => {
    if (!remapComplete) {
      toast.error('Every listed stage needs a mapping before continuing');
      return;
    }
    await runExecute(remapOverrides);
  };

  const handleCheckStatusOnMount = useCallback(async () => {
    try {
      const response = await apiInstance.get<ApiEnvelope<JobStatusResponse>>(
        `/admin/board-config-copy/status/${targetBoardId}`,
      );
      const status = response.data.data;
      if (!status) return;
      if (status.state === 'active' || status.state === 'waiting') {
        setJobId(targetBoardId);
        setJobStatus(status);
        setStep('progress');
        startPolling(targetBoardId);
      } else if (status.state === 'completed' || status.state === 'failed') {
        setPreviousJobStatus(status);
      }
    } catch {
      // No prior job for this board — nothing to recover, stay on the select step.
    }
  }, [targetBoardId, startPolling]);

  useEffect(() => {
    if (isOpen) {
      void handleCheckStatusOnMount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] max-w-3xl h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        <header className='flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            {(step === 'remap' || (step === 'result' && previousJobStatus)) && (
              <Button variant='ghost' size='sm' onClick={() => setStep('select')}>
                <ArrowLeft size={15} /> Back
              </Button>
            )}
            <span className='text-sm font-medium text-foreground truncate'>
              Copy board configuration
            </span>
            {targetBoardName && <Badge variant='secondary'>into {targetBoardName}</Badge>}
          </div>
          <Button variant='ghost' size='iconSm' onClick={handleClose} aria-label='Close'>
            <X size={16} />
          </Button>
        </header>

        <div className='flex-1 overflow-y-auto p-4 space-y-4'>
          {step === 'select' && (
            <>
              {previousJobStatus && (
                <div className='flex items-start justify-between gap-3 text-xs bg-muted/40 border border-border rounded-md px-3 py-2'>
                  <span className='text-muted-foreground'>
                    {previousJobStatus.state === 'completed'
                      ? 'A previous copy into this board completed.'
                      : `A previous copy into this board failed${previousJobStatus.failedReason ? `: ${previousJobStatus.failedReason}` : '.'}`}
                  </span>
                  <div className='flex items-center gap-3 shrink-0'>
                    <button
                      type='button'
                      className='text-primary hover:underline'
                      onClick={() => {
                        setSummary(previousJobStatus.result ?? null);
                        setResultError(
                          previousJobStatus.state === 'failed'
                            ? (previousJobStatus.failedReason ?? 'The copy job failed')
                            : null,
                        );
                        setStep('result');
                      }}
                      data-track-category='BOARD_CONFIG_COPY'
                      data-track-name='VIEW_PREVIOUS_JOB_RESULT'
                    >
                      View details
                    </button>
                    <button
                      type='button'
                      aria-label='Dismiss'
                      className='text-muted-foreground hover:text-foreground'
                      onClick={() => setPreviousJobStatus(null)}
                      data-track-category='BOARD_CONFIG_COPY'
                      data-track-name='DISMISS_PREVIOUS_JOB_BANNER'
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              <div>
                <p className='text-sm font-medium text-foreground mb-1.5 block'>
                  Copy configuration from
                </p>
                <EntitySelector
                  options={sourceOptions}
                  selectedValue={sourceBoardId}
                  onSelect={setSourceBoardId}
                  placeholder='Select source board'
                  searchPlaceholder='Search boards...'
                  showSearch={true}
                  width='100%'
                  testId='copy-config-source-board-picker'
                />
              </div>

              <div className='space-y-2'>
                <p className='text-sm font-medium text-foreground block'>What to copy</p>
                {[
                  { key: 'customFields' as const, label: 'Custom fields & settings' },
                  { key: 'roles' as const, label: 'Roles' },
                  { key: 'stages' as const, label: 'Stages' },
                ].map(item => (
                  <label
                    key={item.key}
                    htmlFor={`copy-config-category-${item.key}`}
                    className='flex items-center gap-2 px-3 py-2 border border-border rounded-md cursor-pointer hover:bg-muted/40'
                  >
                    <input
                      id={`copy-config-category-${item.key}`}
                      type='checkbox'
                      checked={categories[item.key]}
                      onChange={e =>
                        setCategories(prev => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      data-track-category='BOARD_CONFIG_COPY'
                      data-track-name='TOGGLE_CATEGORY'
                    />
                    <span className='text-sm text-foreground'>{item.label}</span>
                  </label>
                ))}
              </div>

              {planError && <p className='text-sm text-destructive'>{planError}</p>}
            </>
          )}

          {step === 'remap' && plan && (
            <>
              <div className='space-y-1'>
                {plan.warnings.map(warning => (
                  <p
                    key={warning}
                    className='text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2'
                  >
                    {warning}
                  </p>
                ))}
              </div>

              <p className='text-sm text-muted-foreground'>
                Every old stage below has existing tickets — choose which new stage each should land
                on. A stage can only be mapped to a new stage of the same status.
              </p>

              {planLoading ? (
                <p className='text-sm text-muted-foreground'>Loading...</p>
              ) : (
                <StageRemapTable
                  rows={visibleRemapRows.map(stage => ({
                    oldStageId: stage.id,
                    oldStageName: stage.name,
                    ticketCount: stage.ticketCount,
                    defaultStatus: stage.defaultTicketStatusV2,
                  }))}
                  newStageOptions={newStageOptions}
                  value={remapOverrides}
                  onChange={(oldStageId, newStageId) =>
                    setRemapOverrides(prev => ({ ...prev, [oldStageId]: newStageId }))
                  }
                />
              )}
            </>
          )}

          {step === 'progress' && (
            <div className='space-y-3'>
              <p className='text-sm text-foreground'>Copying board configuration…</p>
              {jobStatus?.progress && (
                <div className='space-y-1'>
                  <div className='w-full h-2 rounded-full bg-muted overflow-hidden'>
                    <div
                      className='h-full bg-[#185FA5] transition-all'
                      style={{
                        width: `${
                          jobStatus.progress.total > 0
                            ? Math.min(
                                100,
                                (jobStatus.progress.processed / jobStatus.progress.total) * 100,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {jobStatus.progress.processed} / {jobStatus.progress.total} tickets (
                    {jobStatus.progress.batches} batches)
                  </p>
                </div>
              )}
              <p className='text-xs text-muted-foreground'>
                This can take a few minutes for large boards — you can close this window and check
                back later; the copy keeps running in the background.
              </p>
            </div>
          )}

          {step === 'result' && (
            <div className='space-y-3'>
              {resultError && <p className='text-sm text-destructive'>{resultError}</p>}
              {summary && (
                <div className='space-y-2 text-sm'>
                  <p className='text-foreground'>
                    Custom fields copied: {summary.customFieldsCopied ? 'yes' : 'no'} · Roles
                    copied: {summary.rolesCopied ? 'yes' : 'no'}
                  </p>
                  {summary.stages && (
                    <div className='border border-border rounded-md p-3 space-y-1'>
                      <p>Batches: {summary.stages.batches}</p>
                      <p>Processed: {summary.stages.processed}</p>
                      <p>Updated: {summary.stages.updated}</p>
                      <p>Skipped: {summary.stages.skipped}</p>
                      <p>Errors: {summary.stages.errors}</p>
                      <p>New stages: {summary.stages.newStageCount}</p>
                      <p>Old stages removed: {summary.stages.deletedOldStageCount}</p>
                      {summary.stages.failedTicketIds.length > 0 && (
                        <Button
                          variant='secondary'
                          size='sm'
                          onClick={() =>
                            void copyTextToClipboard(
                              summary.stages!.failedTicketIds.join('\n'),
                            ).then(() => toast.success('Failed ticket IDs copied to clipboard'))
                          }
                        >
                          Copy {summary.stages.failedTicketIds.length} failed ticket ID(s)
                        </Button>
                      )}
                    </div>
                  )}
                  {summary.warnings.length > 0 && (
                    <div className='space-y-1'>
                      {summary.warnings.map(warning => (
                        <p
                          key={warning}
                          className='text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2'
                        >
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className='flex items-center justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0'>
          {step === 'result' || step === 'progress' ? (
            <Button
              variant='secondary'
              onClick={() => {
                onDone?.();
                handleClose();
              }}
            >
              Close
            </Button>
          ) : (
            <>
              <Button variant='secondary' onClick={handleClose}>
                Cancel
              </Button>
              {step === 'select' && (
                <Button
                  className='bg-[#185FA5] hover:bg-[#0C447C] text-white'
                  onClick={() => void handleContinueFromSelect()}
                  disabled={planLoading || executing}
                >
                  {planLoading || executing ? 'Working…' : 'Continue'}
                </Button>
              )}
              {step === 'remap' && (
                <Button
                  className='bg-[#185FA5] hover:bg-[#0C447C] text-white'
                  onClick={() => void handleContinueFromRemap()}
                  disabled={!remapComplete || executing}
                >
                  {executing ? 'Working…' : 'Copy configuration'}
                </Button>
              )}
            </>
          )}
        </footer>
      </div>
      <ConfirmDialog />
    </div>
  );
};

export default BoardConfigCopyScreen;
