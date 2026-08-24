import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import {
  User,
  ChannelScopeType,
  type HistoryPreviewEntry,
  type HistoryScope,
  type HistoryScopeMode,
} from '@xyne/shared';
import { AddPeopleHistoryStep } from './AddPeopleHistoryStep';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { toast } from 'sonner';
import { mutators } from '../../../zero/mutators';
import { useChannel } from '../../../hooks/useChannels';
import { channelService } from '../../../services/Chat/channelService';
import { useMutation, useQuery } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { isOneToOneDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import type { AddPeopleFormProps, AddPeopleStep } from './AddPeopleForm.types';
import {
  buildHistoryScope,
  groupByDay,
  hasChosenCutoff,
  isScopeValid,
  previewLowerBound,
} from './AddPeopleForm.utils';

export const AddPeopleForm: React.FC<AddPeopleFormProps> = ({
  channelId,
  existingUserIds: propExistingUserIds,
  onSuccess,
  onCancel,
  loading = false,
  embedded = false,
  onContextChange,
}) => {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<AddPeopleStep>('people');
  const [scopeMode, setScopeMode] = useState<HistoryScopeMode>('today');
  const [customDate, setCustomDate] = useState<string>('');
  const [confirmingFullHistory, setConfirmingFullHistory] = useState(false);
  const { isMobile } = usePlatform();
  const zero = useZero();
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  const [participantsData] = useCachedQuery(queries.channelParticipants({ channelId }));

  const isDirectConversation = channel
    ? isOneToOneDMChannel(channel.scopeType) || channel.scopeType === ChannelScopeType.GROUP_DM
    : false;

  const existingUserIds = useMemo(
    () => propExistingUserIds || (participantsData || []).map(p => p.userId),
    [propExistingUserIds, participantsData],
  );

  const scope: HistoryScope = useMemo(
    () => buildHistoryScope(scopeMode, customDate),
    [scopeMode, customDate],
  );

  const cutoffChosen = hasChosenCutoff(scopeMode, customDate);
  const previewEnabled = step === 'history' && scopeMode !== 'none' && cutoffChosen;

  const previewSince = previewLowerBound(scope);
  const { data: previewData } = useQuery({
    queryKey: ['dm-history-preview', channelId, previewSince],
    queryFn: () =>
      channelService.getDmHistoryPreview(channelId, { since: previewSince, limit: 20 }),
    enabled: previewEnabled,
    staleTime: 30_000,
  });

  const previewGroups = useMemo(
    () => (previewEnabled ? groupByDay<HistoryPreviewEntry>(previewData?.conversations ?? []) : []),
    [previewEnabled, previewData],
  );

  useEffect(() => {
    onContextChange?.({ step, isDirectConversation });
  }, [step, isDirectConversation, onContextChange]);

  const addParticipantsMutation = useMutation({
    mutationFn: (payload: { userIds: string[]; historyScope: HistoryScope }) =>
      channelService.addGroupDmParticipants(channelId, payload),
    onSuccess: response => {
      onSuccess?.();
      void navigate(`/chat/dir/${response.channelId}`);
    },
    onError: () => {
      toast.error('Failed to add people', {
        description: 'Could not add people to this conversation. Please try again.',
        duration: 3000,
      });
    },
  });

  const goToStep = (next: AddPeopleStep): void => {
    setConfirmingFullHistory(false);
    setStep(next);
  };

  const handleScopeModeChange = (next: HistoryScopeMode): void => {
    setConfirmingFullHistory(false);
    setScopeMode(next);
  };

  const handleNext = (): void => {
    if (selectedUsers.length === 0) return;
    if (isDirectConversation) {
      // Still ask about history when the group already exists — the messages get moved into it.
      goToStep('history');
      return;
    }
    handleSubmit();
  };

  const handleSubmit = (): void => {
    if (selectedUsers.length === 0) return;

    const userIds = selectedUsers.map(user => user.id);

    if (isDirectConversation) {
      if (scopeMode === 'beginning' && !confirmingFullHistory) {
        setConfirmingFullHistory(true);
        return;
      }
      addParticipantsMutation.mutate({ userIds, historyScope: scope });
      return;
    }

    setIsSubmitting(true);
    try {
      const participantIds = userIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      const userStatusIds = userIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      void zero.mutate(
        mutators.channel.addParticipants({
          channelId,
          userIds,
          timestamp: Date.now(),
          participantIds,
          userStatusIds,
        }),
      );
      setSelectedUsers([]);
      onSuccess?.();
    } catch {
      toast.error('Failed to add participants', {
        description: 'Could not add participants. Please try again.',
        duration: 3000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = (): void => {
    setSelectedUsers([]);
    goToStep('people');
    onCancel?.();
  };

  const isLoading = isSubmitting || loading || addParticipantsMutation.isPending;
  const canConfirm = isScopeValid(scopeMode, customDate) && !isLoading;

  const historyFooter = (
    <div className='flex items-center justify-between gap-3 border-t border-border pt-4'>
      <p className='text-xs text-muted-foreground'>Once included, it can&apos;t be undone.</p>
      <div className='flex gap-3'>
        <Button
          variant='ghost'
          size='default'
          onClick={() => goToStep('people')}
          disabled={isLoading}
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name='Back_History_Scope'
        >
          Back
        </Button>
        <Button
          variant='default'
          size='default'
          onClick={() => void handleSubmit()}
          disabled={!canConfirm}
          loading={isLoading}
          data-testid='add-people-confirm'
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name='ADD_PEOPLE_SUBMIT'
          data-track-metadata={JSON.stringify({ selectedUsers, scopeMode })}
        >
          Done
        </Button>
      </div>
    </div>
  );

  const confirmFooter = (
    <div className='space-y-3 border-t border-border pt-4'>
      <div className='space-y-1'>
        <p className='text-sm font-semibold text-foreground'>Include history from the beginning?</p>
        <p className='text-sm text-muted-foreground'>
          This lets everyone see past messages and files once they&apos;re added to the
          conversation.
        </p>
      </div>
      <div className='flex justify-end gap-3'>
        <Button
          variant='ghost'
          size='default'
          onClick={() => setConfirmingFullHistory(false)}
          disabled={isLoading}
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name='Go_Back_Full_History'
        >
          Go Back
        </Button>
        <Button
          variant='default'
          size='default'
          onClick={() => void handleSubmit()}
          disabled={isLoading}
          loading={isLoading}
          data-testid='add-people-confirm-full-history'
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name='CONFIRM_FULL_HISTORY'
          data-track-metadata={JSON.stringify({ selectedUsers })}
        >
          Confirm
        </Button>
      </div>
    </div>
  );

  if (step === 'history') {
    return (
      <AddPeopleHistoryStep
        scopeMode={scopeMode}
        onScopeModeChange={handleScopeModeChange}
        customDate={customDate}
        onCustomDateChange={setCustomDate}
        cutoffChosen={cutoffChosen}
        dimmed={confirmingFullHistory}
        previewGroups={previewGroups}
        hasPreviewItems={previewGroups.length > 0}
        embedded={embedded}
        footer={confirmingFullHistory ? confirmFooter : historyFooter}
      />
    );
  }

  return (
    <div className={cn('space-y-6', !embedded && 'p-4')}>
      <div>
        {!embedded && (
          <h2 className='text-lg font-semibold text-foreground mb-1'>
            {isDirectConversation ? 'Add people to this conversation' : 'Add Members'}
          </h2>
        )}
        <p className='text-sm text-muted-foreground'>Search for users to add to this channel</p>
      </div>

      <div>
        <SearchUser
          excludeUserIds={existingUserIds}
          selectedUsers={selectedUsers}
          onUsersChange={setSelectedUsers}
          placeholder='Search users to add to channel...'
          label='Search Users'
          hintText='Search by name or email to find users to add'
          autoFocus={!isMobile}
        />
      </div>

      <div className='flex justify-end gap-3 border-t border-border pt-4'>
        {onCancel && (
          <Button
            variant='ghost'
            size='default'
            onClick={handleCancel}
            disabled={isLoading}
            data-track-category='ADD_CHAT_PARTICIPANTS'
            data-track-name='Cancel_Add_People'
            data-track-metadata={JSON.stringify({ selectedUsers: selectedUsers })}
          >
            Cancel
          </Button>
        )}
        <Button
          variant='default'
          size='default'
          onClick={() => void handleNext()}
          disabled={selectedUsers.length === 0 || isLoading}
          loading={isLoading}
          data-testid='add-people-submit'
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name={isDirectConversation ? 'NEXT_HISTORY_SCOPE' : 'ADD_PEOPLE_SUBMIT'}
          data-track-metadata={JSON.stringify({ selectedUsers })}
        >
          {isDirectConversation ? 'Next' : 'Add Selected Users'}
        </Button>
      </div>
    </div>
  );
};

export default AddPeopleForm;
