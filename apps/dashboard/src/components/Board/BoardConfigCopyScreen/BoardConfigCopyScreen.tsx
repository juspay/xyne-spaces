import { ReactElement, useCallback, useMemo, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { BoardType, FormContextType, FormEntityType, PRStatusEvent } from '@xyne/shared';
import { toast } from 'sonner';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge/Badge';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { apiInstance } from '../../../services/clients/apiClient';
import { StageRemapTable } from './StageRemapTable';
import type {
  ApiEnvelope,
  CopyCategorySelection,
  CopyResultSummary,
  PrepareCopyResult,
} from './BoardConfigCopyScreen.types';

interface BoardConfigCopyScreenProps {
  targetBoardId: string;
  targetBoardName?: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}

type Step = 'select' | 'remap' | 'result';

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
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const zero = useZero();

  const [projectBoards] = useCachedQuery(
    queries.boardsListByProject({ projectId: projectId || '' }),
    {
      enabled: !!projectId,
    },
  );

  const [step, setStep] = useState<Step>('select');
  const [sourceBoardId, setSourceBoardId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CopyCategorySelection>({
    customFields: false,
    roles: false,
    stages: false,
  });

  const [plan, setPlan] = useState<PrepareCopyResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [remapOverrides, setRemapOverrides] = useState<Record<string, string>>({});

  const [executing, setExecuting] = useState(false);
  const [summary, setSummary] = useState<CopyResultSummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  // Whether the just-started ticket migration is still running in the background — there is
  // no status/progress endpoint to poll, so this is shown once and never updated.
  const [migrationPending, setMigrationPending] = useState(false);

  const sourceOptions: SelectorOption[] = useMemo(
    () =>
      (projectBoards ?? [])
        .filter(board => board.id !== targetBoardId && board.boardType !== BoardType.RELEASE)
        .map(board => ({ value: board.id, label: board.name, icon: null })),
    [projectBoards, targetBoardId],
  );

  const resetForClose = (): void => {
    setStep('select');
    setSourceBoardId(null);
    setCategories({ customFields: false, roles: false, stages: false });
    setPlan(null);
    setPlanError(null);
    setRemapOverrides({});
    setExecuting(false);
    setSummary(null);
    setResultError(null);
    setMigrationPending(false);
  };

  const handleClose = (): void => {
    resetForClose();
    onClose();
  };

  /**
   * Plan-only call: `dryRun: true` makes /prepare describe the copy (stages, counts,
   * suggested mapping) without writing a snapshot or cloning a form, so the remap picker
   * can be rendered — and re-rendered — without side effects.
   */
  const fetchPlan = useCallback(async (): Promise<PrepareCopyResult | null> => {
    if (!sourceBoardId) return null;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const response = await apiInstance.post<ApiEnvelope<PrepareCopyResult>>(
        '/admin/board-config-copy/prepare',
        { sourceBoardId, targetBoardId, categories, dryRun: true },
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
      // result still attached under `data.data` — surface it if present so the UI can show
      // the structured `errors` list, not just a generic message.
      const withResponse = error as {
        response?: { data?: ApiEnvelope<PrepareCopyResult> };
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

  /**
   * Awaits a Zero mutator's authoritative server result. Zero resolves (never rejects) on
   * application errors, so a bare `void zero.mutate(...)` would silently roll the
   * optimistic write back and let the copy continue on a board that was never updated.
   */
  const commitMutation = async (
    mutation: { server: Promise<{ type?: string; error?: { message?: string } } | undefined> },
    failureMessage: string,
  ): Promise<void> => {
    const res = await mutation.server;
    if (res?.type === 'error') {
      throw new Error(res.error?.message ?? failureMessage);
    }
  };

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
    // Clear any stale summary carried over from a PRIOR run within this same still-mounted
    // session — a fresh run must never render leftover numbers from a different copy.
    setSummary(null);
    setMigrationPending(false);
    try {
      const stageRemapOverrides = categories.stages
        ? Object.entries(overrides ?? remapOverrides).map(([oldStageId, newStageId]) => ({
            oldStageId,
            newStageId,
          }))
        : undefined;

      // 1. Server-only half: validation, pre-copy snapshot, and the custom-fields form
      //    clone. Deliberately writes no board configuration — it just hands back the
      //    arguments for the mutations below.
      const response = await apiInstance.post<ApiEnvelope<PrepareCopyResult>>(
        '/admin/board-config-copy/prepare',
        {
          sourceBoardId,
          targetBoardId,
          categories,
          ...(categories.stages && { stageRemapOverrides }),
          dryRun: false,
        },
      );
      const result = response.data.data;
      if (!result) throw new Error(response.data.error ?? 'Copy could not be prepared');
      // No `prepared` means the plan still has unresolved stage mappings — the caller
      // reached here without completing the remap step, so nothing was written.
      const prepared = result.prepared;
      if (!prepared) throw new Error('Every old stage with tickets needs a target stage first');

      // 2. Commit the configuration through the ordinary board mutators — the same path a
      //    hand-edited board save takes. `board.update` carries the whole change: it
      //    upserts the copied stages, deletes every target stage absent from that list
      //    (with their approvers/PR-status/form mappings), and replaces board metadata and
      //    type in one atomic mutation.
      await commitMutation(
        zero.mutate(
          mutators.board.update({
            ...prepared.boardUpdate,
            boardType: prepared.boardUpdate.boardType as BoardType,
            stages: prepared.boardUpdate.stages?.map(stage => ({
              ...stage,
              prStatuses: stage.prStatuses as PRStatusEvent[],
            })),
            timestamp: Date.now(),
          }),
        ),
        'Failed to apply the copied board configuration',
      );

      if (prepared.boardFormMapping) {
        await commitMutation(
          zero.mutate(
            mutators.formContextMapping.upsert({
              ...prepared.boardFormMapping,
              contextType: prepared.boardFormMapping.contextType as FormContextType,
              entityType: prepared.boardFormMapping.entityType as FormEntityType,
            }),
          ),
          'Failed to bind the copied custom fields to this board',
        );
      }

      if (prepared.transitions) {
        await commitMutation(
          zero.mutate(
            mutators.nonLinear.syncTransitions({
              boardId: targetBoardId,
              transitions: prepared.transitions,
              now: Date.now(),
            }),
          ),
          'Failed to copy stage transitions',
        );
      }

      const configSummary: CopyResultSummary = {
        customFieldsCopied: prepared.customFieldsCopied,
        rolesCopied: prepared.rolesCopied,
        newStageCount: prepared.newStageCount,
        deletedOldStageCount: prepared.deletedOldStageCount,
        warnings: result.warnings,
        snapshotPath: prepared.snapshotPath,
      };

      // 3. Hand the remaining per-ticket work (stage remap, custom-field value repointing)
      //    to the background job and move on — there is no status endpoint to watch it
      //    with, so this is fire-and-forget from here. The plan is /prepare's own payload
      //    passed straight back; the server re-checks every destination in it against the
      //    stages that now exist, so this side never inspects or edits it.
      setSummary(configSummary);
      if (prepared.ticketMigration) {
        const migrationResponse = await apiInstance.post<ApiEnvelope<{ jobId: string }>>(
          '/admin/board-config-copy/start-ticket-migration',
          prepared.ticketMigration,
        );
        if (!migrationResponse.data.data?.jobId) {
          throw new Error(migrationResponse.data.error ?? 'Ticket migration did not start');
        }
        setMigrationPending(true);
      }
      setStep('result');
      toast.success('Board configuration copied');
    } catch (error) {
      const message = extractErrorMessage(error, 'Failed to copy board configuration');
      toast.error('Copy failed', { description: message, duration: 5000 });
      setResultError(message);
      setStep('result');
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

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-background flex flex-col w-[90vw] max-w-3xl h-[85vh] rounded-lg shadow-xl overflow-hidden border border-border'>
        <header className='flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0'>
          <div className='flex items-center gap-2 min-w-0'>
            {step === 'remap' && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setStep('select')}
                data-track-category='BOARD_CONFIG_COPY'
                data-track-name='BACK_TO_SELECT_STEP'
              >
                <ArrowLeft size={15} /> Back
              </Button>
            )}
            <span className='text-sm font-medium text-foreground truncate'>
              Copy board configuration
            </span>
            {targetBoardName && <Badge variant='secondary'>into {targetBoardName}</Badge>}
          </div>
          <Button
            variant='ghost'
            size='iconSm'
            onClick={handleClose}
            data-track-category='BOARD_CONFIG_COPY'
            data-track-name='CLOSE_MODAL'
            aria-label='Close'
          >
            <X size={16} />
          </Button>
        </header>

        <div className='flex-1 overflow-y-auto p-4 space-y-4'>
          {step === 'select' && (
            <>
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

          {step === 'result' && (
            <div className='space-y-3'>
              {resultError && <p className='text-sm text-destructive'>{resultError}</p>}
              {summary && (
                <div className='space-y-2 text-sm'>
                  <p className='text-foreground'>Copied successfully.</p>
                  {migrationPending && (
                    <p className='text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2'>
                      Existing tickets are being moved onto the new stages in the background.
                    </p>
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
          {step === 'result' ? (
            <Button
              variant='secondary'
              onClick={() => {
                onDone?.();
                handleClose();
              }}
              data-track-category='BOARD_CONFIG_COPY'
              data-track-name='CLOSE_AFTER_COPY'
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                variant='secondary'
                onClick={handleClose}
                data-track-category='BOARD_CONFIG_COPY'
                data-track-name='CANCEL_COPY'
              >
                Cancel
              </Button>
              {step === 'select' && (
                <Button
                  className='bg-[#185FA5] hover:bg-[#0C447C] text-white'
                  onClick={() => void handleContinueFromSelect()}
                  data-track-category='BOARD_CONFIG_COPY'
                  data-track-name='CONTINUE_FROM_SELECT'
                  disabled={planLoading || executing}
                >
                  {planLoading || executing ? 'Working…' : 'Continue'}
                </Button>
              )}
              {step === 'remap' && (
                <Button
                  className='bg-[#185FA5] hover:bg-[#0C447C] text-white'
                  onClick={() => void handleContinueFromRemap()}
                  data-track-category='BOARD_CONFIG_COPY'
                  data-track-name='CONFIRM_COPY_CONFIG'
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
