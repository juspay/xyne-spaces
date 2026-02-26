import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Maximize2, Minimize2 } from 'lucide-react';
import { RCAStatus } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
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
import type {
  ImpactType,
  COEType,
  ImpactAttachment,
} from '../../../routes/RCAScreen/RCAScreen.types';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useRCALookups } from '../../../hooks/useRCALookups';
import { useRCASubmissions } from '../../../hooks/useRCASubmissions';
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

export const RCAPanelView = ({ ticketId }: RCAPanelViewProps) => {
  const zero = useZero();

  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedImpactId, setSelectedImpactId] = useState<string | null>(null);
  const [selectedCoeId, setSelectedCoeId] = useState<string | null>(null);
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('');
  const [bugLookupsLoaded, setBugLookupsLoaded] = useState(false);
  const [impactLookupsLoaded, setImpactLookupsLoaded] = useState(false);
  const [coeLookupsLoaded, setCoeLookupsLoaded] = useState(false);

  // Fetch existing RCA for this ticket
  const [rcaData] = useCachedQuery(queries.rcaByTicketId({ ticketId }), {
    enabled: !!ticketId,
  });
  const selectedRecord = rcaData ?? null;
  const {
    handleCreateRCA,
    handleRcaSubmit,
    uploadImpactAttachments,
    handleCoeSubmit,
    activePhase,
    setActivePhase,
    isSubmitting,
    isCreatingRCA,
    pendingImpacts,
    setPendingImpacts,
    impactDraftById,
    setImpactDraftById,
    draftImpactFilesById,
    setDraftImpactFilesById,
    pendingCOEs,
    setPendingCOEs,
    pendingRCA,
    setPendingRCA,
  } = useRCASubmissions({
    ticketId,
    selectedRecord,
  });

  const {
    ownerItems,
    releaseAttributionsData,
    releaseTicketsData,
    releaseSubTicketsData,
    impactTypeOptions,
    bugTypeOptions,
    bugTypeValueById,
    categoryTypeOptions,
    categoryValueById,
    coeActionTypeOptions,
    coeActionTypeValueById,
    quickFixActionTypeId,
    excludedCoeActionTypeIds,
    issueCategoryOptionsByCategoryValue,
    issueCategoryValueById,
  } = useRCALookups({
    ticketId,
    activePhase,
    selectedRecord,
    pendingRCA,
    bugLookupsLoaded,
    impactLookupsLoaded,
    coeLookupsLoaded,
  });

  const selectedImpact = useMemo<ImpactType | null>(() => {
    if (!selectedRecord) return null;
    const impacts = selectedRecord.impacts ?? [];
    if (selectedImpactId) {
      return impacts.find(entry => entry.id === selectedImpactId) ?? impacts[0] ?? null;
    }
    return impacts[0] ?? null;
  }, [selectedRecord, selectedImpactId]);

  const [impactAttachmentsData] = useCachedQuery(
    queries.attachmentsByImpact({ impactId: selectedImpact?.id ?? '' }),
    { enabled: !!selectedImpact?.id },
  );
  const impactAttachments = (impactAttachmentsData ?? []) as ImpactAttachment[];

  const selectedCoe = useMemo<COEType | null>(() => {
    if (!selectedRecord) return null;
    const coes = (selectedRecord.coes ?? []).filter(
      coe => !excludedCoeActionTypeIds.has(coe.actionTypeId),
    );
    if (selectedCoeId) {
      return coes.find(entry => entry.id === selectedCoeId) ?? coes[0] ?? null;
    }
    return coes[0] ?? null;
  }, [selectedRecord, selectedCoeId, excludedCoeActionTypeIds]);

  const isRcaEditable = selectedRecord?.status !== RCAStatus.CLOSED;
  const isImpactEnabled = selectedRecord?.status !== RCAStatus.CLOSED;
  const isCoeEnabled = selectedRecord?.status !== RCAStatus.CLOSED;

  const filteredOwnerItems = useFilteredItems(ownerItems, ownerSearchQuery);

  // Sync selected impact/coe when record changes
  useEffect(() => {
    if (!selectedRecord) {
      setSelectedImpactId(null);
      setSelectedCoeId(null);
      return;
    }

    const impacts = selectedRecord.impacts ?? [];
    const coes = (selectedRecord.coes ?? []).filter(
      coe => !excludedCoeActionTypeIds.has(coe.actionTypeId),
    );

    if (!impacts.some(entry => entry.id === selectedImpactId)) {
      setSelectedImpactId(impacts[0]?.id ?? null);
    }
    if (!coes.some(entry => entry.id === selectedCoeId)) {
      setSelectedCoeId(coes[0]?.id ?? null);
    }
  }, [selectedRecord, selectedImpactId, selectedCoeId, excludedCoeActionTypeIds]);

  useEffect(() => {
    setSelectedImpactId(null);
    setSelectedCoeId(null);
    setBugLookupsLoaded(false);
    setImpactLookupsLoaded(false);
    setCoeLookupsLoaded(false);
  }, [ticketId]);

  // Removed activePhase dependency from here because activePhase is now managed by the hook.
  // We can't easily sync local lookup state back to the hook's activePhase if we depend on it.
  // Instead, the new useRCASubmissions hook manages activePhase. We'll extract activePhase below.

  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsExpanded(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  // the hook call for submissions was moved up here

  useEffect(() => {
    if (activePhase === 'rca') setBugLookupsLoaded(true);
    if (activePhase === 'impact') setImpactLookupsLoaded(true);
    if (activePhase === 'coe') setCoeLookupsLoaded(true);
  }, [activePhase]);

  let content: React.ReactNode;

  if (!selectedRecord) {
    content = (
      <div className='flex flex-col items-center justify-center h-full text-gray-500 gap-4 p-6'>
        <ClipboardCheck className='h-12 w-12 text-gray-300' />
        <div className='text-center'>
          <p className='text-sm font-medium text-gray-900'>No RCA for this ticket</p>
          <p className='text-xs text-gray-500 mt-1'>
            Create a Root Cause Analysis to track the incident.
          </p>
        </div>
        <button
          type='button'
          className='px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50'
          onClick={() => void handleCreateRCA(bugTypeOptions, categoryTypeOptions)}
          disabled={isCreatingRCA}
          data-track-category='RCA'
          data-track-name='StartRCAFromPanel'
        >
          {isCreatingRCA ? 'Creating...' : 'Start RCA'}
        </button>
      </div>
    );
  } else if (selectedRecord.status === RCAStatus.CLOSED) {
    content = (
      <div className='p-4 overflow-y-auto h-full'>
        <RCADetailsView
          selectedRecord={selectedRecord}
          ownerItems={ownerItems}
          impactTypeOptions={impactTypeOptions}
          coeActionTypeOptions={coeActionTypeOptions}
          bugTypeOptions={bugTypeOptions}
          categoryTypeOptions={categoryTypeOptions}
          issueCategoryValueById={issueCategoryValueById}
          releaseTickets={releaseTicketsData ?? []}
          releaseAttributions={releaseAttributionsData ?? []}
          attributedSubTickets={releaseSubTicketsData ?? []}
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
            isImpactEnabled={isImpactEnabled}
            isCoeEnabled={isCoeEnabled}
            onPhaseClick={setActivePhase}
          />
        </div>

        <div className='flex-1 overflow-y-auto p-4'>
          {activePhase === 'release' ? (
            <ReleaseMappingForm
              ticketId={selectedRecord.ticketId}
              releaseAttributions={releaseAttributionsData ?? []}
              attributedSubTickets={releaseSubTicketsData ?? []}
              isSubmitting={isSubmitting}
              onPhaseChange={setActivePhase}
            />
          ) : activePhase === 'impact' ? (
            <ImpactForm
              selectedRecord={selectedRecord}
              isImpactEnabled={isImpactEnabled}
              isSubmitting={isSubmitting}
              impactTypeOptions={impactTypeOptions}
              impactAttachments={impactAttachments}
              onAddImpactAttachments={uploadImpactAttachments}
              onRemoveImpactAttachment={(attachmentId: string): Promise<void> => {
                zero.mutate(mutators.messageAttachment.delete({ attachmentId }));
                return Promise.resolve();
              }}
              pendingImpacts={pendingImpacts}
              selectedImpact={selectedImpact}
              impactDraftById={impactDraftById}
              setImpactDraftById={setImpactDraftById}
              draftImpactFilesById={draftImpactFilesById}
              setDraftImpactFilesById={setDraftImpactFilesById}
              setPendingImpacts={setPendingImpacts}
              setSelectedImpactId={setSelectedImpactId}
              onPhaseChange={setActivePhase}
            />
          ) : activePhase === 'coe' ? (
            <COEForm
              selectedRecord={selectedRecord}
              isCoeEnabled={isCoeEnabled}
              isSubmitting={isSubmitting}
              ownerItems={ownerItems}
              coeActionTypeOptions={coeActionTypeOptions}
              coeActionTypeValueById={coeActionTypeValueById}
              quickFixActionTypeId={quickFixActionTypeId}
              coeStatusOptions={coeStatusOptions}
              pendingCOEs={pendingCOEs}
              selectedCoe={selectedCoe}
              rcaOwnerId={selectedRecord.ownerId}
              setPendingCOEs={setPendingCOEs}
              setSelectedCoeId={setSelectedCoeId}
              onSubmit={() => handleCoeSubmit(bugTypeValueById, categoryValueById, selectedCoe)}
              onPhaseChange={setActivePhase}
              onNavigate={() => {
                /* no-op: panel doesn't navigate */
              }}
              pendingRCA={pendingRCA}
            />
          ) : (
            <RCAForm
              selectedRecord={selectedRecord}
              isRcaEditable={isRcaEditable}
              isSubmitting={isSubmitting}
              ownerItems={ownerItems}
              filteredOwnerItems={filteredOwnerItems}
              ownerSearchQuery={ownerSearchQuery}
              setOwnerSearchQuery={setOwnerSearchQuery}
              bugTypeOptions={bugTypeOptions}
              categoryTypeOptions={categoryTypeOptions}
              bugTypeValueById={bugTypeValueById}
              categoryValueById={categoryValueById}
              issueCategoryOptionsByCategoryValue={issueCategoryOptionsByCategoryValue}
              severityOptions={severityOptions}
              pendingRCA={pendingRCA}
              setPendingRCA={setPendingRCA}
              onSubmit={handleRcaSubmit}
            />
          )}
        </div>
      </div>
    );
  }

  const containerClass = isExpanded
    ? 'fixed inset-0 z-50 bg-white flex flex-col h-screen'
    : 'flex flex-col h-full overflow-hidden relative';

  return (
    <div className={containerClass}>
      {isExpanded && (
        <div className='flex items-center justify-between px-10 py-4 border-b border-gray-200 bg-gray-50'>
          <span className='text-lg font-bold text-gray-900'>Root Cause Analysis</span>
          <button
            type='button'
            className='p-2 rounded-md hover:bg-gray-100 transition-colors'
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
          <span className='text-base font-semibold text-gray-800 truncate'>
            Root Cause Analysis
          </span>
          <button
            type='button'
            className='rounded-md bg-white/90 p-2 shadow-sm ring-1 ring-gray-200 hover:bg-white transition-colors'
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
