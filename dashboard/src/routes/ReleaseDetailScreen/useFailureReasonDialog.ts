import { ReleaseStageOption } from '@/components/Release/ReleaseStagePicker';
import { mutators } from '@/zero/mutators';
import { useZero } from '@xyne/shared/hooks';
import { useState } from 'react';
import { toast } from 'sonner';

export interface FailureDialogState {
  isOpen: boolean;
  artId: string | null;
  artTitle: string;
  failureReason: string;
  selectedStage: ReleaseStageOption | null;
  isSubmitting: boolean;
}

/**
 * Manages all state for the "Mark as Failed" failure-reason dialog.
 * Opening the dialog is triggered by DevTicketStagePicker via `openFor`.
 */
export function useFailureReasonDialog() {
  const zero = useZero();

  const [state, setState] = useState<FailureDialogState>({
    isOpen: false,
    artId: null,
    artTitle: '',
    failureReason: '',
    selectedStage: null,
    isSubmitting: false,
  });

  const openFor = (
    artId: string | null,
    artTitle: string,
    stage: ReleaseStageOption,
    currentFailureReason?: string,
  ) => {
    setState({
      isOpen: true,
      artId,
      artTitle,
      failureReason: currentFailureReason ?? '',
      selectedStage: stage,
      isSubmitting: false,
    });
  };

  const close = () => {
    setState(prev => ({
      ...prev,
      isOpen: false,
      failureReason: '',
      artId: null,
      selectedStage: null,
    }));
  };

  const setFailureReason = (reason: string) => {
    setState(prev => ({ ...prev, failureReason: reason }));
  };

  const submit = async () => {
    const { artId, failureReason, selectedStage } = state;
    if (!artId || !failureReason.trim()) return;
    setState(prev => ({ ...prev, isSubmitting: true }));
    try {
      const result = zero.mutate(
        mutators.applicationReleaseTicket.updateStatus({
          id: artId,
          stageName: selectedStage?.name,
          defaultTicketStatusV2: selectedStage?.defaultTicketStatusV2 ?? undefined,
          failureReason: failureReason.trim(),
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        throw new Error(res.error.message || 'Failed to save failure reason');
      }
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save failure reason');
    } finally {
      setState(prev => ({ ...prev, isSubmitting: false }));
    }
  };

  return { state, openFor, close, setFailureReason, submit };
}
