import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { RCAStatus, AttachmentEntityType, SEVERITY } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';
import { mutators } from '../zero/mutators';
import { impactSchema } from '../routes/RCAScreen/schemas';
import type {
  Phase,
  PendingImpact,
  PendingCOE,
  RCAFormValues,
  DetailedRcaRecord,
  SelectOption,
  COEType,
} from '../routes/RCAScreen/RCAScreen.types';
import { useZero } from './useZero';
import { useAuth } from './useAuth';

export interface UseRCASubmissionsProps {
  ticketId: string;
  selectedRecord: DetailedRcaRecord | null;
}

export const useRCASubmissions = ({ ticketId, selectedRecord }: UseRCASubmissionsProps) => {
  const zero = useZero();
  const { user } = useAuth();
  const userId = user?.id;

  const [activePhase, setActivePhase] = useState<Phase>('release');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingRCA, setIsCreatingRCA] = useState(false);
  const [pendingImpacts, setPendingImpacts] = useState<PendingImpact[]>([]);
  const [impactDraftById, setImpactDraftById] = useState<
    Record<string, Pick<PendingImpact, 'impactTypeId' | 'impact'>>
  >({});
  const [draftImpactFilesById, setDraftImpactFilesById] = useState<Record<string, File[]>>({});
  const [pendingCOEs, setPendingCOEs] = useState<PendingCOE[]>([]);
  const [pendingRCA, setPendingRCA] = useState<Partial<RCAFormValues> | null>(null);

  // Sync effect from original component to clear drafts when record changes or unmounts
  useEffect(() => {
    if (!selectedRecord) {
      setPendingImpacts([]);
      setImpactDraftById({});
      setDraftImpactFilesById({});
    }
  }, [selectedRecord]);

  useEffect(() => {
    setActivePhase('release');
    setImpactDraftById({});
    setDraftImpactFilesById({});
  }, [ticketId]);

  const handleCreateRCA = async (
    bugTypeOptions: SelectOption[],
    categoryTypeOptions: SelectOption[],
  ): Promise<void> => {
    setIsCreatingRCA(true);
    try {
      if (!bugTypeOptions.length || !categoryTypeOptions.length) {
        toast.error('Bug type and category must be configured before creating an RCA');
        return;
      }
      const newRcaId = uuidv4();
      const mutationResult = zero.mutate(
        mutators.rca.create({
          id: newRcaId,
          ticketId,
          ownerId: userId || '',
          title: '',
          severity: SEVERITY.SEV_1, // Fallback default
          bugTypeId: '',
          categoryTypeId: '',
          issueCategoryId: '',
          status: RCAStatus.DRAFT,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to create RCA');
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create RCA');
    } finally {
      setIsCreatingRCA(false);
    }
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
      setPendingRCA(null);
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
      (impact: PendingImpact) => !impact.impactTypeId || !impact.impact.trim(),
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
      .filter((mutation): mutation is NonNullable<typeof mutation> => mutation !== null);

    const createMutations = pendingImpacts.map((impact: PendingImpact) => {
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
        const updateResults = await Promise.all(updateMutations.map(m => m.server));
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
      setImpactDraftById((prev: Record<string, Pick<PendingImpact, 'impactTypeId' | 'impact'>>) => {
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

  const handleCoeSubmit = async (
    bugTypeValueById: Map<string, string>,
    categoryValueById: Map<string, string>,
    selectedCoe: COEType | null,
  ): Promise<void> => {
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
          (coe: PendingCOE) => !coe.ownerId || !coe.actionTypeId || !coe.action.trim(),
        );
        if (invalidCOEs.length > 0) {
          toast.error('Please complete all pending COE details');
          return;
        }

        const coeMutationPromises = pendingCOEs.map((coe: PendingCOE) =>
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit COE');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    handleCreateRCA,
    handleRcaSubmit,
    uploadImpactAttachments,
    persistImpactDrafts,
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
  };
};
