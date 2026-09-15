import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  MaximizeTwoArrow as Maximize2,
  MinimizeTwoArrow as Minimize2,
} from '@xyne/icons';
import { RCAStatus } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { queries } from '../../../zero/queries';
import {
  RCAForm,
  RCADetailsView,
  ImpactForm,
  COEForm,
  RCAPhaseStepper,
  ReleaseMappingForm,
} from '../../../routes/RCAScreen/components';
import {
  phases,
  coeStatusOptions,
  severityOptions,
} from '../../../routes/RCAScreen/RCAScreen.utils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useRCALookups } from '../../../hooks/useRCALookups';
import { useRCASubmissions } from '../../../hooks/useRCASubmissions';
import { useAuth } from '../../../hooks/useAuth';
import { useCacConfig } from '@xyne/shared/hooks';
import { DEFAULT_RCA_CAC_CONFIG, type RcaCacConfig } from '../../../routes/RCAScreen/rcaCacConfig';
import type { FormControllerRef } from '../../../routes/RCAScreen/RCAScreen.types';
interface RCAPanelViewProps {
  ticketId: string;
}

const useFilteredItems = <T extends { label: string }>(items: T[], searchQuery: string): T[] => {
  return useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item => item.label.toLowerCase().includes(query));
  }, [items, searchQuery]);
};

export const RCAPanelView = ({ ticketId }: RCAPanelViewProps): React.ReactElement => {
  const { user } = useAuth();
  const { config } = useCacConfig<RcaCacConfig>({
    key: 'rca_config',
    fallbackConfig: DEFAULT_RCA_CAC_CONFIG,
  });
  const rcaFormRef = useRef<FormControllerRef | null>(null);
  const impactFormRef = useRef<FormControllerRef | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });
  const [isClosedEditMode, setIsClosedEditMode] = useState(false);
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('');

  // Fetch existing RCA for this ticket
  const [rcaData] = useCachedQuery(queries.rcaByTicketId({ ticketId }), {
    enabled: !!ticketId,
  });
  const selectedRecord = rcaData ?? null;
  const {
    handleCreateRCA,
    handleRcaSubmit,
    handleCoeSubmit,
    activePhase,
    setActivePhase,
    isSubmitting,
    isCreatingRCA,
  } = useRCASubmissions({
    ticketId,
    selectedRecord,
    config,
  });

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
    ticketId,
    selectedRecord,
    config,
  });

  const isOwner = !!selectedRecord && !!user?.id && selectedRecord.ownerId === user.id;
  const canEditRca =
    isOwner &&
    (selectedRecord?.status === RCAStatus.DRAFT || selectedRecord?.status === RCAStatus.CLOSED);
  const canEditInView = canEditRca && selectedRecord?.status === RCAStatus.CLOSED;
  const isReadOnlyView =
    !isOwner ||
    selectedRecord?.status === RCAStatus.IN_REVIEW ||
    selectedRecord?.status === RCAStatus.APPROVED ||
    (selectedRecord?.status === RCAStatus.CLOSED && !isClosedEditMode);

  const filteredOwnerItems = useFilteredItems(ownerItems, ownerSearchQuery);

  useEffect(() => {
    setIsClosedEditMode(false);
  }, [ticketId]);

  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsExpanded(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return (): void => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  // the hook call for submissions was moved up here

  useEffect(() => {
    if (selectedRecord?.status !== RCAStatus.CLOSED && isClosedEditMode) {
      setIsClosedEditMode(false);
    }
  }, [selectedRecord?.status, isClosedEditMode]);

  useEffect((): (() => void) => {
    return (): void => {
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

  const handlePhaseClick = async (phase: typeof activePhase): Promise<void> => {
    if (!canEditRca) {
      setActivePhase(phase);
      return;
    }

    if (
      activePhase === 'rca' &&
      phase !== 'rca' &&
      rcaFormRef.current?.hasUnsavedChanges() &&
      rcaFormRef.current
    ) {
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
            return;
          }
        } catch {
          toast.error('Error saving RCA details');
          return;
        }
      } else {
        rcaFormRef.current.discard?.();
      }
    }

    if (
      activePhase === 'impact' &&
      phase !== 'impact' &&
      impactFormRef.current?.hasUnsavedChanges() &&
      impactFormRef.current
    ) {
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
            return;
          }
        } catch {
          toast.error('Error saving Impact details');
          return;
        }
      } else {
        impactFormRef.current.discard?.();
      }
    }

    setActivePhase(phase);
  };

  let content: React.ReactNode;

  if (!selectedRecord) {
    content = (
      <div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-4 p-6'>
        <ClipboardCheck className='h-12 w-12 text-muted' />
        <div className='text-center'>
          <p className='text-sm font-medium text-foreground'>No RCA for this ticket</p>
          <p className='text-xs text-muted-foreground mt-1'>
            Create a Root Cause Analysis to track the incident.
          </p>
        </div>
        <button
          type='button'
          className='px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50'
          onClick={() => void handleCreateRCA()}
          disabled={isCreatingRCA}
          data-ph-capture-attribute-track-id='rca_start_from_panel'
          data-track-category='RCA'
          data-track-name='StartRCAFromPanel'
        >
          {isCreatingRCA ? 'Creating...' : 'Start RCA'}
        </button>
      </div>
    );
  } else if (isReadOnlyView) {
    content = (
      <div className='p-4 overflow-y-auto h-full'>
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
          {...(canEditInView && {
            onEdit: (): void => {
              setIsClosedEditMode(true);
              setActivePhase('release');
            },
          })}
        />
      </div>
    );
  } else {
    content = (
      <div className='flex flex-col h-full overflow-hidden'>
        <div className='shrink-0'>
          <RCAPhaseStepper
            phases={phases}
            activePhase={activePhase}
            isImpactEnabled={canEditRca}
            isCoeEnabled={canEditRca}
            onPhaseClick={handlePhaseClick}
          />
        </div>

        <div className='flex-1 overflow-y-auto p-4'>
          <div className={activePhase === 'release' ? 'block h-full' : 'hidden'}>
            <ReleaseMappingForm
              ticketId={selectedRecord.ticketId}
              releaseAttributions={releaseAttributionsData ?? []}
              attributedSubTickets={releaseSubTicketsData ?? []}
              isSubmitting={isSubmitting}
              onPhaseChange={phase => {
                void handlePhaseClick(phase);
              }}
            />
          </div>

          <div className={activePhase === 'impact' ? 'block h-full' : 'hidden'}>
            <ImpactForm
              selectedRecord={selectedRecord}
              isImpactEnabled={canEditRca}
              isSubmitting={isSubmitting}
              impactTypeOptions={impactTypeOptions}
              controllerRef={impactFormRef}
              onPhaseChange={phase => {
                void handlePhaseClick(phase);
              }}
            />
          </div>

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
              onSubmit={async () => {
                const didSubmit = await handleCoeSubmit();
                if (didSubmit && selectedRecord?.status === RCAStatus.CLOSED) {
                  setIsClosedEditMode(false);
                  setActivePhase('rca');
                }
              }}
              onPhaseChange={phase => {
                void handlePhaseClick(phase);
              }}
            />
          </div>

          <div className={activePhase === 'rca' ? 'block h-full' : 'hidden'}>
            <RCAForm
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
              controllerRef={rcaFormRef}
              onSubmit={async values => {
                await handleRcaSubmit(values);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const containerClass = isExpanded
    ? 'fixed inset-0 z-50 bg-background flex flex-col h-screen'
    : 'flex flex-col h-full overflow-hidden relative';

  return (
    <div className={containerClass}>
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
      {isExpanded && (
        <div className='flex items-center justify-between px-10 py-4 border-b border-border bg-muted'>
          <span className='text-lg font-bold text-foreground'>Root Cause Analysis</span>
          <button
            type='button'
            className='p-2 rounded-md hover:bg-muted transition-colors'
            onClick={() => setIsExpanded(prev => !prev)}
            aria-label='Collapse RCA panel'
            title='Collapse'
            data-track-category='RCA'
            data-track-name='CollapseRCAPanel'
          >
            <Minimize2 size={16} />
          </button>
        </div>
      )}
      {!isExpanded && (
        <div className='flex items-center justify-between px-4 py-2'>
          <span className='text-base font-semibold text-foreground truncate'>
            Root Cause Analysis
          </span>
          <button
            type='button'
            className='rounded-md bg-background/90 p-2 shadow-sm ring-1 ring-border hover:bg-background transition-colors'
            onClick={() => setIsExpanded(true)}
            aria-label='Expand RCA panel'
            title='Expand'
            data-track-category='RCA'
            data-track-name='ExpandRCAPanel'
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}
      <div className={isExpanded ? 'flex-1 overflow-hidden px-6 pb-6' : 'flex-1 overflow-hidden'}>
        {content}
      </div>
    </div>
  );
};
