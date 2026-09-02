import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { RCAStatus } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { queries } from '../../zero/queries';
import {
  RCAForm,
  RCADetailsView,
  ImpactForm,
  COEForm,
  RCAPhaseStepper,
  ReleaseMappingForm,
} from './components';
import { phases, coeStatusOptions, severityOptions } from './RCAScreen.utils';
import type { FormControllerRef, Phase, RCAFormValues } from './RCAScreen.types';
import { useRCALookups } from '../../hooks/useRCALookups';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';
import { useCacConfig } from '@xyne/shared/hooks';
import { DEFAULT_RCA_CAC_CONFIG, type RcaCacConfig } from './rcaCacConfig';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';

const useFilteredItems = <T extends { label: string }>(items: T[], searchQuery: string): T[] => {
  return useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item => item.label.toLowerCase().includes(query));
  }, [items, searchQuery]);
};

const RCADetailScreen = () => {
  const navigate = useNavigate();
  const { rcaId } = useParams<{ rcaId?: string }>();
  const zero = useZero();
  const { user } = useAuth();
  const { config } = useCacConfig<RcaCacConfig>({
    key: 'rca_config',
    fallbackConfig: DEFAULT_RCA_CAC_CONFIG,
  });

  const rcaFormRef = useRef<FormControllerRef | null>(null);
  const impactFormRef = useRef<FormControllerRef | null>(null);

  const [activePhase, setActivePhase] = useState<Phase>('release');
  const [isClosedEditMode, setIsClosedEditMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('');
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  const [rcaByIdData] = useCachedQuery(queries.rcaById({ rcaId: rcaId ?? '' }), {
    enabled: !!rcaId,
  });

  const selectedRecord = rcaId && rcaByIdData ? rcaByIdData : null;
  const {
    ownerItems,
    releaseAttributionsData,
    releaseTicketsData,
    releaseSubTicketsData,
    impactTypeOptions,
    bugTypeOptions,
    categoryOptions,
    categoryOptionsByBugTypeValue,
    coeActionTypeOptions,
    coeActionLabelByValue,
    quickFixOptions,
    quickFixActionValue,
    hiddenCoeActionValues,
    issueCategoryOptionsByCategoryValue,
    issueCategoryRequiredByCategoryValue,
  } = useRCALookups({
    ticketId: selectedRecord?.ticketId ?? '',
    selectedRecord,
    config,
  });

  const isOwner = !!selectedRecord && !!user?.id && selectedRecord.ownerId === user.id;
  const canEditRca =
    isOwner &&
    (selectedRecord?.status === RCAStatus.DRAFT || selectedRecord?.status === RCAStatus.CLOSED);

  const filteredOwnerItems = useFilteredItems(ownerItems, ownerSearchQuery);

  useEffect(() => {
    setActivePhase('release');
    setIsClosedEditMode(false);
  }, [rcaId]);

  useEffect(() => {
    if (selectedRecord?.status === RCAStatus.CLOSED && activePhase === 'release') {
      setActivePhase('rca');
    }
  }, [selectedRecord?.status, activePhase]);

  useEffect(() => {
    if (selectedRecord?.status !== RCAStatus.CLOSED && isClosedEditMode) {
      setIsClosedEditMode(false);
    }
  }, [selectedRecord?.status, isClosedEditMode]);

  useEffect(() => {
    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
    };
  }, []);

  const askForPhaseSaveConfirmation = (message: string): Promise<boolean> =>
    new Promise((resolve): void => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({ open: true, message });
    });

  const closeConfirmDialog = (result: boolean): void => {
    setConfirmDialog(prev => ({ ...prev, open: false }));
    if (confirmResolverRef.current) {
      confirmResolverRef.current(result);
      confirmResolverRef.current = null;
    }
  };

  const handlePhaseClick = async (phase: Phase): Promise<void> => {
    // Auto-save current phase before transitioning
    if (
      activePhase === 'rca' &&
      phase !== 'rca' &&
      canEditRca &&
      rcaFormRef.current?.hasUnsavedChanges()
    ) {
      if (rcaFormRef.current) {
        const shouldSave = await askForPhaseSaveConfirmation(
          'You have unsaved changes in the RCA phase. Save before moving?',
        );
        if (shouldSave) {
          try {
            const saved = await rcaFormRef.current.save();
            if (saved) {
              toast.success('RCA details saved');
            } else {
              toast.error('Could not save RCA details. Please check required fields.');
              return; // Stay on current phase
            }
          } catch {
            toast.error('Error saving RCA details');
            return; // Stay on current phase
          }
        } else {
          rcaFormRef.current.discard?.();
        }
      }
    }

    if (
      activePhase === 'impact' &&
      phase !== 'impact' &&
      canEditRca &&
      impactFormRef.current?.hasUnsavedChanges()
    ) {
      if (impactFormRef.current) {
        const shouldSave = await askForPhaseSaveConfirmation(
          'You have unsaved changes in the Impact phase. Save before moving?',
        );
        if (shouldSave) {
          try {
            const saved = await impactFormRef.current.save();
            if (saved) {
              toast.success('Impact details saved');
            } else {
              toast.error('Could not save Impact details. Please check required fields.');
              return; // Stay on current phase
            }
          } catch {
            toast.error('Error saving Impact details');
            return; // Stay on current phase
          }
        } else {
          impactFormRef.current.discard?.();
        }
      }
    }
    setActivePhase(phase);
  };

  const handleRcaSubmit = async (values: RCAFormValues): Promise<void> => {
    if (!selectedRecord) return;
    if (!canEditRca) {
      toast.error('Only the RCA owner can edit this RCA');
      return;
    }

    setIsSubmitting(true);
    try {
      const mutationResult = zero.mutate(
        mutators.rca.update({
          id: selectedRecord.id,
          ticketId: values.ticketId,
          title: values.title,
          summary: values.summary,
          rootCause: values.rootCause,
          severity: values.severity,
          bugTypeId: values.bugType,
          categoryTypeId: values.category,
          issueCategoryId: values.issueCategory,
          issueStartAt: values.issueStartAt ?? null,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to submit RCA');
        return;
      }

      // If RCA is closed, go back to view mode; otherwise proceed to impact phase
      if (selectedRecord.status === RCAStatus.CLOSED) {
        toast.success('RCA details saved');
        setIsClosedEditMode(false);
      } else {
        toast.success('Moved to Impact phase');
        setActivePhase('impact');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit RCA');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCoeSubmit = async (): Promise<void> => {
    if (!selectedRecord) return;
    if (!canEditRca) {
      toast.error('Only the RCA owner can edit this RCA');
      return;
    }

    const rcaFormSaved = await rcaFormRef.current?.save();
    if (rcaFormSaved === false) {
      setActivePhase('rca');
      return;
    }

    const impactFormSaved = await impactFormRef.current?.save();
    if (impactFormSaved === false) {
      setActivePhase('impact');
      return;
    }

    const isClosedEditFlow = selectedRecord.status === RCAStatus.CLOSED && isClosedEditMode;

    setIsSubmitting(true);
    try {
      const rcaUpdateResult = zero.mutate(
        mutators.rca.update({
          id: selectedRecord.id,
          status: RCAStatus.CLOSED,
          timestamp: Date.now(),
        }),
      );
      const rcaServerResult = await rcaUpdateResult.server;
      if (rcaServerResult.type === 'error') {
        toast.error(rcaServerResult.error.message || 'Failed to close RCA');
        return;
      }

      if (isClosedEditFlow) {
        toast.success('RCA updated successfully');
        setIsClosedEditMode(false);
        setActivePhase('rca');
        return;
      }

      toast.success('RCA completed successfully');
      void navigate('/rca');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit COE');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPhaseContent = () => {
    if (!selectedRecord) {
      return (
        <div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-3'>
          <ClipboardCheck className='h-12 w-12 text-muted' />
          <p className='text-sm'>RCA not found.</p>
          <button
            type='button'
            className='px-4 py-2 border rounded-lg text-sm hover:bg-muted'
            onClick={() => void navigate('/rca')}
            data-track-category='RCA'
            data-track-name='BackToRCAListFromNotFound'
          >
            Back to list
          </button>
        </div>
      );
    }

    if (!canEditRca || (selectedRecord.status === RCAStatus.CLOSED && !isClosedEditMode)) {
      return (
        <RCADetailsView
          selectedRecord={selectedRecord}
          ownerItems={ownerItems}
          impactTypeOptions={impactTypeOptions}
          coeActionTypeOptions={coeActionTypeOptions}
          coeActionLabelByValue={coeActionLabelByValue}
          quickFixActionValue={quickFixActionValue}
          releaseTickets={releaseTicketsData ?? []}
          releaseAttributions={releaseAttributionsData ?? []}
          attributedSubTickets={releaseSubTicketsData ?? []}
          {...(canEditRca && {
            onEdit: () => {
              setIsClosedEditMode(true);
              setActivePhase('rca');
            },
          })}
        />
      );
    }

    // Render all forms but only show the active one to preserve draft state
    return (
      <>
        {/* RCA Form */}
        <div className={activePhase === 'rca' ? 'block h-full' : 'hidden'}>
          <RCAForm
            controllerRef={rcaFormRef}
            selectedRecord={selectedRecord}
            isRcaEditable={canEditRca}
            isSubmitting={isSubmitting}
            ownerItems={ownerItems}
            filteredOwnerItems={filteredOwnerItems}
            ownerSearchQuery={ownerSearchQuery}
            setOwnerSearchQuery={setOwnerSearchQuery}
            bugTypeOptions={bugTypeOptions}
            categoryOptions={categoryOptions}
            categoryOptionsByBugTypeValue={categoryOptionsByBugTypeValue}
            issueCategoryOptionsByCategoryValue={issueCategoryOptionsByCategoryValue}
            issueCategoryRequiredByCategoryValue={issueCategoryRequiredByCategoryValue}
            severityOptions={severityOptions}
            onSubmit={handleRcaSubmit}
          />
        </div>

        {/* Release Mapping Form */}
        <div className={activePhase === 'release' ? 'block h-full' : 'hidden'}>
          <ReleaseMappingForm
            ticketId={selectedRecord.ticketId}
            releaseAttributions={releaseAttributionsData ?? []}
            attributedSubTickets={releaseSubTicketsData ?? []}
            isSubmitting={isSubmitting}
            onPhaseChange={setActivePhase}
          />
        </div>

        {/* Impact Form */}
        <div className={activePhase === 'impact' ? 'block h-full' : 'hidden'}>
          <ImpactForm
            controllerRef={impactFormRef}
            selectedRecord={selectedRecord}
            isImpactEnabled={canEditRca}
            isSubmitting={isSubmitting}
            impactTypeOptions={impactTypeOptions}
            onPhaseChange={setActivePhase}
          />
        </div>

        {/* COE Form */}
        <div className={activePhase === 'coe' ? 'block h-full' : 'hidden'}>
          <COEForm
            selectedRecord={selectedRecord}
            isCoeEnabled={canEditRca}
            isSubmitting={isSubmitting}
            ownerItems={ownerItems}
            coeActionTypeOptions={coeActionTypeOptions}
            coeActionLabelByValue={coeActionLabelByValue}
            quickFixOptions={quickFixOptions}
            quickFixActionValue={quickFixActionValue}
            hiddenCoeActionValues={hiddenCoeActionValues}
            coeStatusOptions={coeStatusOptions}
            rcaOwnerId={selectedRecord.ownerId}
            onSubmit={handleCoeSubmit}
            onPhaseChange={setActivePhase}
          />
        </div>
      </>
    );
  };

  return (
    <div className='h-full bg-muted' data-id='rca-screen'>
      <Dialog
        open={confirmDialog.open}
        onOpenChange={open => {
          if (!open) closeConfirmDialog(false);
        }}
        title='Unsaved changes'
      >
        <div className='p-6'>
          <h3 className='text-lg font-semibold text-foreground'>Unsaved changes</h3>
          <p className='mt-2 text-sm text-muted-foreground'>{confirmDialog.message}</p>
          <div className='mt-6 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => closeConfirmDialog(false)}
              data-track-category='RCA'
              data-track-name='CANCEL_RCA_CONFIRM'
            >
              Skip Save
            </Button>
            <Button
              type='button'
              onClick={() => closeConfirmDialog(true)}
              data-track-category='RCA'
              data-track-name='CONFIRM_RCA_ACTION'
            >
              Save and Continue
            </Button>
          </div>
        </div>
      </Dialog>
      <section className='h-full flex-1 flex flex-col'>
        <div className='border-b border-border bg-background px-6 py-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <h2 className='text-lg font-semibold text-foreground'>RCA Workspace</h2>
              <p className='text-sm text-muted-foreground'>
                Track release mapping, RCA, Impact, and COE phases for each incident.
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              <button
                type='button'
                className='px-3 py-1.5 border rounded-lg text-sm hover:bg-muted'
                onClick={() => void navigate('/rca')}
                data-track-category='RCA'
                data-track-name='BackToRCAListFromWorkspace'
              >
                Back to list
              </button>
            </div>
          </div>
        </div>

        <div className='p-6 space-y-6 overflow-y-auto flex-1'>
          {selectedRecord &&
            canEditRca &&
            (selectedRecord.status !== RCAStatus.CLOSED || isClosedEditMode) && (
              <RCAPhaseStepper
                phases={phases}
                activePhase={activePhase}
                isImpactEnabled={canEditRca}
                isCoeEnabled={canEditRca}
                onPhaseClick={handlePhaseClick}
              />
            )}
          {renderPhaseContent()}
        </div>
      </section>
    </div>
  );
};

RCADetailScreen.displayName = 'RCADetailScreen';

export default RCADetailScreen;
