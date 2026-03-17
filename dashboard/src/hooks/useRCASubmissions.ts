import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { RCAStatus, SEVERITY } from '@xyne/shared';
import { mutators } from '../zero/mutators';
import type { Phase, RCAFormValues, DetailedRcaRecord } from '../routes/RCAScreen/RCAScreen.types';
import { useZero } from './useZero';
import { useAuth } from './useAuth';
import { requiresIssueCategory, type RcaCacConfig } from '../routes/RCAScreen/rcaCacConfig';

export interface UseRCASubmissionsProps {
  ticketId: string;
  selectedRecord: DetailedRcaRecord | null;
  config: RcaCacConfig;
}

export const useRCASubmissions = ({ ticketId, selectedRecord, config }: UseRCASubmissionsProps) => {
  const zero = useZero();
  const { user } = useAuth();
  const userId = user?.id;
  const isOwner = !!selectedRecord && !!userId && selectedRecord.ownerId === userId;

  const [activePhase, setActivePhase] = useState<Phase>('release');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingRCA, setIsCreatingRCA] = useState(false);

  useEffect(() => {
    setActivePhase('release');
  }, [ticketId]);

  const handleCreateRCA = async (): Promise<void> => {
    setIsCreatingRCA(true);
    try {
      const newRcaId = uuidv4();
      const mutationResult = zero.mutate(
        mutators.rca.create({
          id: newRcaId,
          ticketId,
          ownerId: userId || '',
          title: '',
          severity: SEVERITY.SEV_1,
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

  const handleRcaSubmit = async (values: RCAFormValues): Promise<boolean> => {
    if (!selectedRecord) return false;
    if (!isOwner) {
      toast.error('Only the RCA owner can edit this RCA');
      return false;
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
        return false;
      }

      if (selectedRecord.status === RCAStatus.CLOSED) {
        toast.success('RCA details saved');
      } else {
        toast.success('Moved to Impact phase');
      }
      setActivePhase('impact');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit RCA');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCoeSubmit = async (): Promise<boolean> => {
    if (!selectedRecord) return false;
    if (!isOwner) {
      toast.error('Only the RCA owner can edit this RCA');
      return false;
    }
    if (
      !selectedRecord.summary?.trim() ||
      !selectedRecord.rootCause?.trim() ||
      !selectedRecord.bugTypeId ||
      !selectedRecord.categoryTypeId ||
      (requiresIssueCategory(config, selectedRecord.bugTypeId, selectedRecord.categoryTypeId) &&
        !selectedRecord.issueCategoryId) ||
      !selectedRecord.issueStartAt
    ) {
      toast.error('Please complete all RCA details before submitting COE.');
      return false;
    }

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
        return false;
      }

      toast.success('RCA completed successfully');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to submit COE');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    handleCreateRCA,
    handleRcaSubmit,
    handleCoeSubmit,
    activePhase,
    setActivePhase,
    isSubmitting,
    isCreatingRCA,
  };
};
