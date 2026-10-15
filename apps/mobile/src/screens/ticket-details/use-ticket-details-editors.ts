import type { EtaManagementView, TicketPriority } from '@xyne/shared';
import { parseTicketEtaManagement } from '@xyne/shared';
import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { useZero } from '@/src/hooks/useZero';

import { toAssignedToValue } from './assignment-utils';
import { decideDateUpdate } from './date-update-decision';
import { normalizeTimestamp } from './helpers';
import { runTicketMutation } from './run-ticket-mutation';
import {
  buildTicketTagV2DeleteArgs,
  diffLabelConfirmChanges,
  type AppliedTicketLabel,
} from './ticket-labels';

type StageLike = {
  id?: string | null;
  name?: string | null;
  defaultTicketStatusV2?: string | null;
  eta?: unknown;
};

type StageEtaEntryLike = {
  id?: string | null;
  stageLeftAt?: number | null;
};

type TicketEditorTicket = {
  id: string;
  eta?: number | null;
  metadata?: unknown;
  stageEtaEntries?: ReadonlyArray<StageEtaEntryLike> | null;
} | null;

type UseTicketDetailsEditorsArgs = {
  ticket: TicketEditorTicket;
  rawAssignedTo: string | null;
  assigneeUserId: string | null;
  assigneeGroupId: string | null;
  /** Authoritative ticket.userGroupId (not assignee-as-group fallback). */
  ticketUserGroupId: string | null;
  selectedPriority: TicketPriority | null;
  selectedBoardId: string | null;
  selectedStageName: string | null;
  selectedTicketType: string | null;
  projectId: string;
  isBoardsLoading: boolean;
  boardStages: ReadonlyArray<StageLike> | null | undefined;
  appliedLabels: readonly AppliedTicketLabel[];
  currentStageInfo: StageLike | null;
  currentStageEntry: StageEtaEntryLike | null;
  statusDeadlineMs: number | null;
};

export function useTicketDetailsEditors({
  ticket,
  rawAssignedTo,
  assigneeUserId,
  assigneeGroupId,
  ticketUserGroupId,
  selectedPriority,
  selectedBoardId,
  selectedStageName,
  selectedTicketType,
  projectId,
  isBoardsLoading,
  boardStages,
  appliedLabels,
  currentStageInfo,
  currentStageEntry,
  statusDeadlineMs,
}: UseTicketDetailsEditorsArgs) {
  const zero = useZero();

  const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false);
  const [isPriorityPickerOpen, setIsPriorityPickerOpen] = useState(false);
  const [isAssigneeUpdating, setIsAssigneeUpdating] = useState(false);
  const isAssigneeUpdatingRef = useRef(false);
  const [isUserGroupPickerOpen, setIsUserGroupPickerOpen] = useState(false);
  const [isUserGroupUpdating, setIsUserGroupUpdating] = useState(false);
  const isUserGroupUpdatingRef = useRef(false);
  const [isBoardPickerOpen, setIsBoardPickerOpen] = useState(false);
  const [isStatusPickerOpen, setIsStatusPickerOpen] = useState(false);
  const [isTypePickerOpen, setIsTypePickerOpen] = useState(false);
  const [isLabelsPickerOpen, setIsLabelsPickerOpen] = useState(false);
  const [isDueDatePickerOpen, setIsDueDatePickerOpen] = useState(false);
  const [isStatusDeadlinePickerOpen, setIsStatusDeadlinePickerOpen] = useState(false);

  const requireTicketId = useCallback((): string | null => {
    if (!ticket?.id) {
      showMessageToast('Ticket is still loading.', 'warning');
      return null;
    }
    return ticket.id;
  }, [ticket?.id]);

  const handleOpenAssigneePicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (isAssigneeUpdatingRef.current) {
      showMessageToast('Assignee update in progress.', 'warning');
      return;
    }
    void haptics.selection();
    setIsAssigneePickerOpen(true);
  }, [requireTicketId]);

  const applyAssigneeUpdate = useCallback(
    async (assignedTo: string | null): Promise<void> => {
      if (!ticket?.id || isAssigneeUpdatingRef.current) return;
      isAssigneeUpdatingRef.current = true;
      setIsAssigneeUpdating(true);
      setIsAssigneePickerOpen(false);
      try {
        await runTicketMutation(
          zero.mutate(
            mutators.ticket.updateAssignment({
              ticketId: ticket.id,
              assignedTo,
              timestamp: Date.now(),
            }),
          ),
          'Failed to update assignee',
        );
      } finally {
        isAssigneeUpdatingRef.current = false;
        setIsAssigneeUpdating(false);
      }
    },
    [ticket?.id, zero],
  );

  const handleSelectAssignee = useCallback(
    (userId: string | null): void => {
      if (!ticket?.id || isAssigneeUpdatingRef.current) {
        setIsAssigneePickerOpen(false);
        return;
      }
      if (userId === null) {
        if (!assigneeUserId && !assigneeGroupId) {
          setIsAssigneePickerOpen(false);
          return;
        }
        void applyAssigneeUpdate(null);
        return;
      }
      if (userId === assigneeUserId) {
        setIsAssigneePickerOpen(false);
        return;
      }
      void applyAssigneeUpdate(toAssignedToValue(userId, rawAssignedTo));
    },
    [applyAssigneeUpdate, assigneeGroupId, assigneeUserId, rawAssignedTo, ticket?.id],
  );

  const handleOpenUserGroupPicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (isUserGroupUpdatingRef.current) {
      showMessageToast('User group update in progress.', 'warning');
      return;
    }
    void haptics.selection();
    setIsUserGroupPickerOpen(true);
  }, [requireTicketId]);

  const handleSelectUserGroup = useCallback(
    (groupId: string): void => {
      if (!ticket?.id || isUserGroupUpdatingRef.current) return;
      if (groupId === ticketUserGroupId) {
        setIsUserGroupPickerOpen(false);
        return;
      }
      isUserGroupUpdatingRef.current = true;
      setIsUserGroupUpdating(true);
      setIsUserGroupPickerOpen(false);
      void (async () => {
        try {
          await runTicketMutation(
            zero.mutate(
              mutators.ticket.update({
                id: ticket.id,
                userGroupId: groupId,
                updatedAt: Date.now(),
              }),
            ),
            'Failed to update user group',
          );
        } finally {
          isUserGroupUpdatingRef.current = false;
          setIsUserGroupUpdating(false);
        }
      })();
    },
    [ticket?.id, ticketUserGroupId, zero],
  );

  const handleOpenPriorityPicker = useCallback((): void => {
    if (!requireTicketId()) return;
    void haptics.selection();
    setIsPriorityPickerOpen(true);
  }, [requireTicketId]);

  const handleSelectPriority = useCallback(
    (priority: TicketPriority): void => {
      if (!ticket?.id) return;
      if (priority === selectedPriority) {
        setIsPriorityPickerOpen(false);
        return;
      }
      setIsPriorityPickerOpen(false);
      void runTicketMutation(
        zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            priority,
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update priority',
      );
    },
    [selectedPriority, ticket?.id, zero],
  );

  const handleOpenBoardPicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (!projectId) {
      showMessageToast('No project linked to this ticket.', 'warning');
      return;
    }
    if (isBoardsLoading) {
      showMessageToast('Boards are still loading.', 'warning');
      return;
    }
    void haptics.selection();
    setIsBoardPickerOpen(true);
  }, [isBoardsLoading, projectId, requireTicketId]);

  const handleSelectBoard = useCallback(
    (boardId: string): void => {
      if (!ticket?.id) return;
      if (boardId === selectedBoardId) {
        setIsBoardPickerOpen(false);
        return;
      }
      setIsBoardPickerOpen(false);
      void runTicketMutation(
        zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            boardId,
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update board',
      );
    },
    [selectedBoardId, ticket?.id, zero],
  );

  const handleOpenStatusPicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (!selectedBoardId) {
      showMessageToast('No board linked to this ticket.', 'warning');
      return;
    }
    void haptics.selection();
    setIsStatusPickerOpen(true);
  }, [requireTicketId, selectedBoardId]);

  const handleSelectStatus = useCallback(
    (stageName: string): void => {
      if (!ticket?.id) return;
      if (stageName === selectedStageName) {
        setIsStatusPickerOpen(false);
        return;
      }
      const targetStage = (boardStages ?? []).find(stage => stage.name === stageName);
      const statusV2 = targetStage?.defaultTicketStatusV2 ?? undefined;
      setIsStatusPickerOpen(false);
      void runTicketMutation(
        zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            stageName,
            ...(statusV2 ? { statusV2 } : {}),
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update status',
      );
    },
    [boardStages, selectedStageName, ticket?.id, zero],
  );

  const handleOpenTypePicker = useCallback((): void => {
    if (!requireTicketId()) return;
    void haptics.selection();
    setIsTypePickerOpen(true);
  }, [requireTicketId]);

  const handleSelectType = useCallback(
    (ticketType: string): void => {
      if (!ticket?.id) return;
      if (ticketType === selectedTicketType) {
        setIsTypePickerOpen(false);
        return;
      }
      setIsTypePickerOpen(false);
      void runTicketMutation(
        zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            ticketType,
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update type',
      );
    },
    [selectedTicketType, ticket?.id, zero],
  );

  const handleOpenLabelsPicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (!projectId) {
      showMessageToast('No project linked to this ticket.', 'warning');
      return;
    }
    void haptics.selection();
    setIsLabelsPickerOpen(true);
  }, [projectId, requireTicketId]);

  const handleAddLabel = useCallback(
    async (tagName: string): Promise<boolean> => {
      if (!ticket?.id || !projectId) return false;
      const trimmed = tagName.trim();
      if (!trimmed) return false;
      const alreadyApplied = appliedLabels.some(
        label => label.name === trimmed || label.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (alreadyApplied) return true;
      return runTicketMutation(
        zero.mutate(
          mutators.ticketTagV2.create({
            ticketId: ticket.id,
            tagName: trimmed,
            tagId: uuidv4(),
            projectTagId: uuidv4(),
            mappingId: uuidv4(),
            projectId,
          }),
        ),
        'Failed to add label',
      );
    },
    [appliedLabels, projectId, ticket?.id, zero],
  );

  const handleRemoveLabel = useCallback(
    async (applied: AppliedTicketLabel): Promise<boolean> => {
      if (!ticket?.id || !applied.mappingId) return false;
      return runTicketMutation(
        zero.mutate(mutators.ticketTagV2.delete(buildTicketTagV2DeleteArgs(applied.mappingId))),
        'Failed to remove label',
      );
    },
    [ticket?.id, zero],
  );

  const handleConfirmLabels = useCallback(
    async (nextNames: string[]): Promise<void> => {
      if (!ticket?.id || !projectId) {
        setIsLabelsPickerOpen(false);
        return;
      }
      const { removals, additions } = diffLabelConfirmChanges(appliedLabels, nextNames);
      const results = await Promise.all([
        ...removals.map(applied => handleRemoveLabel(applied)),
        ...additions.map(name => handleAddLabel(name)),
      ]);
      if (!results.every(Boolean)) {
        throw new Error('Failed to update labels');
      }
      setIsLabelsPickerOpen(false);
    },
    [appliedLabels, handleAddLabel, handleRemoveLabel, projectId, ticket?.id],
  );

  const handleOpenDueDatePicker = useCallback((): void => {
    if (!requireTicketId()) return;
    void haptics.selection();
    setIsDueDatePickerOpen(true);
  }, [requireTicketId]);

  const handleAcknowledgeEtaRisk = useCallback(
    async (reason: string): Promise<boolean> => {
      if (!ticket?.id) return false;
      const fingerprint = parseTicketEtaManagement(ticket.metadata).planningRisk.fingerprint;
      if (!fingerprint) return false;
      // The backend and dashboard implement planning-risk acknowledge, but the
      // pinned @xyne/shared (public-source.json) ships no matching Zero mutator,
      // so `acknowledgeEtaRisk` is absent at runtime. Treat it as optional and
      // fail with a toast instead of throwing; drop the guard once shared has it.
      const acknowledgeEtaRisk = (
        mutators.ticket as typeof mutators.ticket & {
          acknowledgeEtaRisk?: (args: {
            ticketId: string;
            expectedFingerprint: string;
            reason: string;
            clientTimestamp: number;
          }) => ReturnType<typeof mutators.ticket.update>;
        }
      ).acknowledgeEtaRisk;
      if (!acknowledgeEtaRisk) {
        showMessageToast('Planning risk acknowledge is unavailable', 'error');
        return false;
      }
      return runTicketMutation(
        zero.mutate(
          acknowledgeEtaRisk({
            ticketId: ticket.id,
            expectedFingerprint: fingerprint,
            reason: reason.trim(),
            clientTimestamp: Date.now(),
          }),
        ),
        'Failed to acknowledge planning risk',
      ).then(ok => {
        if (ok) showMessageToast('Planning risk acknowledged', 'success');
        return ok;
      });
    },
    [ticket?.id, ticket?.metadata, zero],
  );

  const handleSelectDueDate = useCallback(
    (nextEtaMs: number | null): void => {
      if (!ticket?.id || nextEtaMs === null) {
        setIsDueDatePickerOpen(false);
        return;
      }
      const currentEtaMs = normalizeTimestamp(ticket.eta);
      const decision = decideDateUpdate({ currentMs: currentEtaMs, nextMs: nextEtaMs });
      if (decision === 'noop') {
        setIsDueDatePickerOpen(false);
        return;
      }
      if (decision === 'reject_past') {
        showMessageToast('ETA cannot be set to a past date', 'error');
        return;
      }
      setIsDueDatePickerOpen(false);
      void (async () => {
        try {
          await awaitMutation(
            zero.mutate(
              mutators.ticket.update({
                id: ticket.id,
                eta: nextEtaMs,
                updatedAt: Date.now(),
              }),
            ),
          );
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message
              : 'Failed to update due date';
          showMessageToast(message, 'error');
        }
      })();
    },
    [ticket?.eta, ticket?.id, zero],
  );

  const handleOpenStatusDeadlinePicker = useCallback((): void => {
    if (!requireTicketId()) return;
    if (!currentStageInfo?.id) {
      showMessageToast('No stage linked to this ticket.', 'warning');
      return;
    }
    void haptics.selection();
    setIsStatusDeadlinePickerOpen(true);
  }, [currentStageInfo?.id, requireTicketId]);

  const handleSelectStatusDeadline = useCallback(
    (nextStageEtaMs: number | null): void => {
      if (!ticket?.id || !currentStageInfo?.id || nextStageEtaMs === null) {
        setIsStatusDeadlinePickerOpen(false);
        return;
      }
      const decision = decideDateUpdate({
        currentMs: statusDeadlineMs,
        nextMs: nextStageEtaMs,
      });
      if (decision === 'noop') {
        setIsStatusDeadlinePickerOpen(false);
        return;
      }
      if (decision === 'reject_past') {
        showMessageToast('Status Deadline cannot be set to a past date', 'error');
        return;
      }
      const entryId = currentStageEntry?.id ?? uuidv4();
      setIsStatusDeadlinePickerOpen(false);
      void runTicketMutation(
        zero.mutate(
          mutators.ticketStageEta.update({
            id: entryId,
            stageEta: nextStageEtaMs,
            updatedAt: Date.now(),
            ticketId: ticket.id,
            stageId: currentStageInfo.id,
          }),
        ),
        'Failed to update status deadline',
      );
    },
    [currentStageEntry?.id, currentStageInfo?.id, statusDeadlineMs, ticket?.id, zero],
  );

  return {
    // open state
    isAssigneePickerOpen,
    isPriorityPickerOpen,
    isAssigneeUpdating,
    isUserGroupPickerOpen,
    isUserGroupUpdating,
    isBoardPickerOpen,
    isStatusPickerOpen,
    isTypePickerOpen,
    isLabelsPickerOpen,
    isDueDatePickerOpen,
    isStatusDeadlinePickerOpen,
    // closers
    closeAssigneePicker: () => setIsAssigneePickerOpen(false),
    closePriorityPicker: () => setIsPriorityPickerOpen(false),
    closeUserGroupPicker: () => setIsUserGroupPickerOpen(false),
    closeBoardPicker: () => setIsBoardPickerOpen(false),
    closeStatusPicker: () => setIsStatusPickerOpen(false),
    closeTypePicker: () => setIsTypePickerOpen(false),
    closeLabelsPicker: () => setIsLabelsPickerOpen(false),
    closeDueDatePicker: () => setIsDueDatePickerOpen(false),
    closeStatusDeadlinePicker: () => setIsStatusDeadlinePickerOpen(false),
    // openers / selectors
    handleOpenAssigneePicker,
    handleSelectAssignee,
    handleOpenUserGroupPicker,
    handleSelectUserGroup,
    handleOpenPriorityPicker,
    handleSelectPriority,
    handleOpenBoardPicker,
    handleSelectBoard,
    handleOpenStatusPicker,
    handleSelectStatus,
    handleOpenTypePicker,
    handleSelectType,
    handleOpenLabelsPicker,
    handleConfirmLabels,
    handleOpenDueDatePicker,
    handleSelectDueDate,
    handleAcknowledgeEtaRisk,
    handleOpenStatusDeadlinePicker,
    handleSelectStatusDeadline,
  };
}

export type TicketDetailsEditors = ReturnType<typeof useTicketDetailsEditors>;

// Re-export for callers that type against EtaManagementView acknowledge signature.
export type { EtaManagementView };
