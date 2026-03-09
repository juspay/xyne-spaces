import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { RCAStatus, LookupType, AttachmentEntityType } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../hooks/useZero';
import { useUsers } from '../../hooks/useUsers';
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
import { phases, formatEnumLabel, coeStatusOptions, severityOptions } from './RCAScreen.utils';
import { impactSchema } from './schemas';
import type {
  Phase,
  PendingImpact,
  PendingCOE,
  RCAFormValues,
  ImpactType,
  COEType,
  ImpactAttachment,
} from './RCAScreen.types';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';

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

  const [selectedImpactId, setSelectedImpactId] = useState<string | null>(null);
  const [selectedCoeId, setSelectedCoeId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<Phase>('release');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ownerSearchQuery, setOwnerSearchQuery] = useState('');
  const [pendingImpacts, setPendingImpacts] = useState<PendingImpact[]>([]);
  const [impactDraftById, setImpactDraftById] = useState<
    Record<string, Pick<PendingImpact, 'impactTypeId' | 'impact'>>
  >({});
  const [draftImpactFilesById, setDraftImpactFilesById] = useState<Record<string, File[]>>({});
  const [pendingCOEs, setPendingCOEs] = useState<PendingCOE[]>([]);
  const [bugLookupsLoaded, setBugLookupsLoaded] = useState(false);
  const [impactLookupsLoaded, setImpactLookupsLoaded] = useState(false);
  const [coeLookupsLoaded, setCoeLookupsLoaded] = useState(false);

  const [rcaByIdData] = useCachedQuery(queries.rcaById({ rcaId: rcaId ?? '' }), {
    enabled: !!rcaId,
  });

  const selectedRecord = rcaId && rcaByIdData ? rcaByIdData : null;
  const isClosedRca = selectedRecord?.status === RCAStatus.CLOSED;
  const shouldLoadBugLookups =
    isClosedRca || bugLookupsLoaded || activePhase === 'rca' || activePhase === 'coe';
  const shouldLoadImpactLookups = isClosedRca || impactLookupsLoaded || activePhase === 'impact';

  const [impactTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.IMPACT_TYPE }),
    { enabled: shouldLoadImpactLookups },
  );
  const impactTypesData = impactTypesDataRaw ?? [];
  const impactTypeOptions = impactTypesData.map((lt: { id: string; value: string }) => ({
    label: formatEnumLabel(lt.value),
    value: lt.id,
  }));

  const [bugTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_TYPE }),
    { enabled: shouldLoadBugLookups },
  );
  const bugTypesData = bugTypesDataRaw ?? [];
  const bugTypeOptions = bugTypesData.map((lt: { id: string; value: string }) => ({
    label: lt.value,
    value: lt.id,
  }));
  const bugTypeValueById = useMemo(
    () => new Map(bugTypesData.map((lt: { id: string; value: string }) => [lt.id, lt.value])),
    [bugTypesData],
  );

  const [categoryTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_CATEGORY_TYPE }),
    { enabled: shouldLoadBugLookups },
  );
  const categoryTypesData = categoryTypesDataRaw ?? [];
  const categoryTypeOptions = categoryTypesData.map((lt: { id: string; value: string }) => ({
    label: lt.value,
    value: lt.id,
  }));
  const categoryValueById = useMemo(
    () => new Map(categoryTypesData.map((lt: { id: string; value: string }) => [lt.id, lt.value])),
    [categoryTypesData],
  );
  const bugTypeValue = bugTypeValueById.get(selectedRecord?.bugTypeId ?? '') ?? '';
  const categoryValue = categoryValueById.get(selectedRecord?.categoryTypeId ?? '') ?? '';
  const isBugTypeSelected = !!bugTypeValue;
  const isCategorySelected = !!categoryValue;
  const isReliabilityBug = bugTypeValue === 'Reliability';
  const shouldLoadIssueLookups = shouldLoadBugLookups && isBugTypeSelected && isCategorySelected;
  const shouldLoadCoeLookups =
    isClosedRca ||
    coeLookupsLoaded ||
    (activePhase === 'coe' && isBugTypeSelected && (!isReliabilityBug || isCategorySelected));
  const coeLookupType = useMemo(() => {
    if (bugTypeValue === 'Reliability') {
      if (categoryValue === 'Change') return LookupType.COE_ACTION_TYPE_RELIABILITY_CHANGE;
      if (categoryValue === 'Capacity') return LookupType.COE_ACTION_TYPE_RELIABILITY_CAPACITY;
      if (categoryValue === 'Fault') return LookupType.COE_ACTION_TYPE_RELIABILITY_FAULT;
    }
    if (bugTypeValue === 'Performance') return LookupType.COE_ACTION_TYPE_PERF;
    if (bugTypeValue === 'UI/UX') return LookupType.COE_ACTION_TYPE_UIUX;
    return LookupType.COE_ACTION_TYPE;
  }, [bugTypeValue, categoryValue]);

  const [issueCategoryCapacityData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_CAPACITY }),
    { enabled: shouldLoadIssueLookups },
  );
  const [issueCategoryChangeData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_CHANGE }),
    { enabled: shouldLoadIssueLookups },
  );
  const [issueCategoryFaultData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_FAULT }),
    { enabled: shouldLoadIssueLookups },
  );

  const issueCategoryOptionsByCategoryValue = useMemo(() => {
    const toOptions = (data?: Array<{ id: string; value: string }>) =>
      (data ?? []).map(item => ({ label: item.value, value: item.id }));
    return {
      Capacity: toOptions(issueCategoryCapacityData),
      Change: toOptions(issueCategoryChangeData),
      Fault: toOptions(issueCategoryFaultData),
    };
  }, [issueCategoryCapacityData, issueCategoryChangeData, issueCategoryFaultData]);

  const issueCategoryOptions = useMemo(
    () => Object.values(issueCategoryOptionsByCategoryValue).flat(),
    [issueCategoryOptionsByCategoryValue],
  );
  const issueCategoryValueById = useMemo(
    () => new Map(issueCategoryOptions.map(option => [option.value, option.label])),
    [issueCategoryOptions],
  );

  const [coeActionTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: coeLookupType }),
    { enabled: shouldLoadCoeLookups },
  );
  const coeActionTypesData = coeActionTypesDataRaw ?? [];
  const coeActionTypeOptions = coeActionTypesData.map((ct: { id: string; value: string }) => ({
    label: formatEnumLabel(ct.value),
    value: ct.id,
  }));
  const coeActionTypeValueById = useMemo(
    () => new Map(coeActionTypesData.map((ct: { id: string; value: string }) => [ct.id, ct.value])),
    [coeActionTypesData],
  );
  const [baseCoeActionTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.COE_ACTION_TYPE }),
    { enabled: shouldLoadCoeLookups },
  );
  const baseCoeActionTypesData = baseCoeActionTypesDataRaw ?? [];
  const coeActionTypeLabelById = useMemo(() => {
    const entries = [
      ...baseCoeActionTypesData.map((ct: { id: string; value: string }) => [ct.id, ct.value]),
      ...coeActionTypesData.map((ct: { id: string; value: string }) => [ct.id, ct.value]),
    ] as Array<[string, string]>;
    return new Map(entries.map(([id, value]) => [id, formatEnumLabel(value)]));
  }, [baseCoeActionTypesData, coeActionTypesData]);
  const quickFixActionTypeId = useMemo(
    () => baseCoeActionTypesData.find(entry => entry.value === 'QUICK_FIXES_DONE')?.id ?? '',
    [baseCoeActionTypesData],
  );
  const excludedCoeActionTypeIds = useMemo(() => {
    const excludedValues = new Set(['QUICK_FIXES_DONE', 'PREVENTION_PRINCIPLE']);
    return new Set(
      Array.from(coeActionTypeValueById.entries())
        .filter(([, value]) => excludedValues.has(value))
        .map(([id]) => id),
    );
  }, [coeActionTypeValueById]);

  const users = useUsers();
  const ownerItems = useMemo(
    () => users.map(user => ({ label: user.name || user.email, value: user.id })),
    [users],
  );

  const [releaseAttributionsData] = useCachedQuery(
    queries.releaseAttributionsByTicketId({ ticketId: selectedRecord?.ticketId ?? '' }),
    { enabled: !!selectedRecord?.ticketId },
  );
  const releaseTicketIds = useMemo(
    () =>
      Array.from(
        new Set(
          (releaseAttributionsData ?? [])
            .map(attribution => attribution.releaseId)
            .filter((id): id is string => !!id),
        ),
      ),
    [releaseAttributionsData],
  );
  const [releaseTicketsData] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: releaseTicketIds }),
    { enabled: releaseTicketIds.length > 0 },
  );
  const releaseApplicationIds = useMemo(
    () =>
      (releaseAttributionsData ?? [])
        .map(attribution => attribution.releaseApplicationId)
        .filter((id): id is string => !!id),
    [releaseAttributionsData],
  );
  const [releaseSubTicketsData] = useCachedQuery(
    queries.subTicketsByIds({ subTicketIds: releaseApplicationIds }),
    { enabled: releaseApplicationIds.length > 0 },
  );

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

  useEffect(() => {
    if (!selectedRecord) {
      setSelectedImpactId(null);
      setSelectedCoeId(null);
      setPendingImpacts([]);
      setImpactDraftById({});
      setDraftImpactFilesById({});
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
    setActivePhase('release');
    setSelectedImpactId(null);
    setSelectedCoeId(null);
    setBugLookupsLoaded(false);
    setImpactLookupsLoaded(false);
    setCoeLookupsLoaded(false);
    setImpactDraftById({});
    setDraftImpactFilesById({});
  }, [rcaId]);

  useEffect(() => {
    if (activePhase === 'rca') setBugLookupsLoaded(true);
    if (activePhase === 'impact') setImpactLookupsLoaded(true);
    if (activePhase === 'coe') setCoeLookupsLoaded(true);
  }, [activePhase]);

  const handlePhaseClick = (phase: Phase): void => {
    setActivePhase(phase);
  };

  const handleRcaSubmit = async (values: RCAFormValues): Promise<void> => {
    if (!selectedRecord) return;

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
          bugTypeId: values.bugTypeId,
          categoryTypeId: values.categoryTypeId,
          issueCategoryId: values.issueCategoryId,
          issueStartAt: values.issueStartAt ?? null,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to submit RCA');
        return;
      }

      toast.success('Moved to Impact phase');
      setActivePhase('impact');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit RCA');
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadImpactAttachments = async (files: File[], impactId: string): Promise<void> => {
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    const metadata = files.map((_, index) => ({
      fileIndex: index,
      hasThumbnail: false,
      width: undefined,
      height: undefined,
    }));
    formData.append('fileMetadata', JSON.stringify(metadata));
    formData.append('entityId', impactId);
    formData.append('entityType', AttachmentEntityType.IMPACT);

    await apiInstance.post('/attachments/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const persistImpactDrafts = async (): Promise<boolean> => {
    if (!selectedRecord) return false;

    const existingImpacts = selectedRecord.impacts ?? [];
    const pendingInvalid = pendingImpacts.find(
      impact => !impact.impactTypeId || !impact.impact.trim(),
    );
    if (pendingInvalid) {
      toast.error('Please complete all pending impact details');
      return false;
    }

    for (const impact of existingImpacts) {
      const draft = impactDraftById[impact.id];
      if (!draft) continue;
      const validation = impactSchema.safeParse({
        ticketId: selectedRecord.ticketId,
        impactTypeId: draft.impactTypeId,
        impact: draft.impact,
      });
      if (!validation.success) {
        toast.error(validation.error.issues[0]?.message ?? 'Please complete impact details');
        return false;
      }
    }

    const impactIdByTempId = new Map<string, string>();
    const updateMutations = existingImpacts
      .map(impact => {
        const draft = impactDraftById[impact.id];
        if (!draft) return null;
        if (draft.impactTypeId === impact.impactTypeId && draft.impact === (impact.impact ?? '')) {
          return null;
        }
        return zero.mutate(
          mutators.impact.update({
            id: impact.id,
            impactTypeId: draft.impactTypeId,
            impact: draft.impact,
          }),
        );
      })
      .filter(Boolean);

    const createMutations = pendingImpacts.map(impact => {
      const impactId = uuidv4();
      impactIdByTempId.set(impact.tempId, impactId);
      return zero.mutate(
        mutators.impact.create({
          id: impactId,
          ticketId: selectedRecord.ticketId,
          impactTypeId: impact.impactTypeId,
          impact: impact.impact,
          rcaId: selectedRecord.id,
          timestamp: Date.now(),
        }),
      );
    });

    try {
      if (updateMutations.length > 0) {
        const updateResults = await Promise.all(updateMutations.map(m => m!.server));
        const failedUpdate = updateResults.find(r => r.type === 'error');
        if (failedUpdate) {
          toast.error(
            failedUpdate.type === 'error' ? failedUpdate.error.message : 'Failed to update Impact',
          );
          return false;
        }
      }

      if (createMutations.length > 0) {
        const createResults = await Promise.all(createMutations.map(m => m.server));
        const failedCreate = createResults.find(r => r.type === 'error');
        if (failedCreate) {
          toast.error(
            failedCreate.type === 'error' ? failedCreate.error.message : 'Failed to create Impact',
          );
          return false;
        }
      }

      for (const impact of existingImpacts) {
        const files = draftImpactFilesById[impact.id] ?? [];
        if (files.length === 0) continue;
        await uploadImpactAttachments(files, impact.id);
      }

      for (const impact of pendingImpacts) {
        const files = impact.files ?? [];
        if (files.length === 0) continue;
        const impactId = impactIdByTempId.get(impact.tempId);
        if (!impactId) continue;
        await uploadImpactAttachments(files, impactId);
      }

      void zero.mutate(
        mutators.rca.update({
          id: selectedRecord.id,
          timestamp: Date.now(),
        }),
      );

      if (pendingImpacts.length > 0) {
        setPendingImpacts([]);
      }
      setDraftImpactFilesById({});
      setImpactDraftById(prev => {
        if (!selectedRecord) return prev;
        const next = { ...prev };
        for (const impact of existingImpacts) {
          delete next[impact.id];
        }
        return next;
      });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Impact drafts');
      return false;
    }
  };

  const handleCoeSubmit = async (): Promise<void> => {
    if (!selectedRecord) return;
    if (
      !selectedRecord.summary?.trim() ||
      !selectedRecord.rootCause?.trim() ||
      !selectedRecord.bugTypeId ||
      !selectedRecord.categoryTypeId ||
      (bugTypeValueById.get(selectedRecord.bugTypeId) === 'Reliability' &&
        ['Capacity', 'Change', 'Fault'].includes(
          categoryValueById.get(selectedRecord.categoryTypeId) ?? '',
        ) &&
        !selectedRecord.issueCategoryId) ||
      !selectedRecord.issueStartAt
    ) {
      toast.error('Please complete all RCA details before submitting COE.');
      return;
    }

    setIsSubmitting(true);
    try {
      const impactsSaved = await persistImpactDrafts();
      if (!impactsSaved) return;

      if (pendingCOEs.length > 0) {
        const invalidCOEs = pendingCOEs.filter(
          coe => !coe.ownerId || !coe.actionTypeId || !coe.action.trim(),
        );
        if (invalidCOEs.length > 0) {
          toast.error('Please complete all pending COE details');
          return;
        }

        const coeMutationPromises = pendingCOEs.map(coe =>
          zero.mutate(
            mutators.coe.create({
              id: uuidv4(),
              timestamp: Date.now(),
              rcaId: selectedRecord.id,
              ownerId: coe.ownerId,
              actionTypeId: coe.actionTypeId,
              action: coe.action,
              status: coe.status,
            }),
          ),
        );
        const coeResults = await Promise.all(coeMutationPromises.map(r => r.server));
        const failedCoe = coeResults.find(r => r.type === 'error');
        if (failedCoe) {
          toast.error(
            failedCoe.type === 'error' ? failedCoe.error.message : 'Failed to create COE',
          );
          return;
        }

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

        toast.success('RCA completed successfully');
        setPendingCOEs([]);
        void navigate('/rca');
        return;
      }

      if (!selectedCoe) return;

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

    if (activePhase === 'impact') {
      return (
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
      );
    }

    if (selectedRecord.status === RCAStatus.CLOSED) {
      return (
        <RCADetailsView
          selectedRecord={selectedRecord}
          ownerItems={ownerItems}
          impactTypeOptions={impactTypeOptions}
          coeActionTypeOptions={coeActionTypeOptions}
          coeActionTypeLabelById={coeActionTypeLabelById}
          bugTypeOptions={bugTypeOptions}
          categoryTypeOptions={categoryTypeOptions}
          issueCategoryValueById={issueCategoryValueById}
          releaseTickets={releaseTicketsData ?? []}
          releaseAttributions={releaseAttributionsData ?? []}
          attributedSubTickets={releaseSubTicketsData ?? []}
        />
      );
    }

    if (activePhase === 'release') {
      return (
        <ReleaseMappingForm
          ticketId={selectedRecord.ticketId}
          releaseAttributions={releaseAttributionsData ?? []}
          attributedSubTickets={releaseSubTicketsData ?? []}
          isSubmitting={isSubmitting}
          onPhaseChange={setActivePhase}
        />
      );
    }

    if (activePhase === 'coe') {
      return (
        <COEForm
          selectedRecord={selectedRecord}
          isCoeEnabled={isCoeEnabled}
          isSubmitting={isSubmitting}
          ownerItems={ownerItems}
          coeActionTypeOptions={coeActionTypeOptions}
          coeActionTypeLabelById={coeActionTypeLabelById}
          coeActionTypeValueById={coeActionTypeValueById}
          quickFixActionTypeId={quickFixActionTypeId}
          coeStatusOptions={coeStatusOptions}
          pendingCOEs={pendingCOEs}
          selectedCoe={selectedCoe}
          rcaOwnerId={selectedRecord.ownerId}
          setPendingCOEs={setPendingCOEs}
          setSelectedCoeId={setSelectedCoeId}
          onSubmit={handleCoeSubmit}
          onPhaseChange={setActivePhase}
          onNavigate={path => void navigate(path)}
        />
      );
    }

    return (
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
        onSubmit={handleRcaSubmit}
      />
    );
  };

  return (
    <div className='h-full bg-muted' data-id='rca-screen'>
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
                onClick={() => {
                  setSelectedImpactId(null);
                  setSelectedCoeId(null);
                  void navigate('/rca');
                }}
                data-track-category='RCA'
                data-track-name='BackToRCAListFromWorkspace'
              >
                Back to list
              </button>
            </div>
          </div>
        </div>

        <div className='p-6 space-y-6 overflow-y-auto flex-1'>
          {selectedRecord && selectedRecord.status !== RCAStatus.CLOSED && (
            <RCAPhaseStepper
              phases={phases}
              activePhase={activePhase}
              isImpactEnabled={isImpactEnabled}
              isCoeEnabled={isCoeEnabled}
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
