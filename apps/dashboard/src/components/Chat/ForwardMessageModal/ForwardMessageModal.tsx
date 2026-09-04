import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { Badge } from '../../ui/Badge';
import { X, Hash, Lock, Users, Loader2 } from 'lucide-react';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { useRankedActivePeople } from '../../../hooks/useRankedPeopleSearch';
import {
  rankChannelsByAffinity,
  filterChannelsBySearchableNames,
} from '../../../utils/rankingUtils';
import { useAffinityCallback } from '../../../hooks/useAffinityCallback';
import { useAuth } from '../../../hooks/useAuth';
import {
  useChannelSearch,
  useAllChannels,
  useAllVisibleChannels,
} from '../../../hooks/useChannels';
import { useMentionSearch } from '../../../hooks/useMentionSearch';
import { RenderMessageWithHTML } from '../RenderMessageWithHTML/RenderMessageWithHTML';
import { MessageAttachment } from '../MessageAttachment/MessageAttachment';
import {
  formatFullTimestamp,
  formatRelativeTime,
  formatRelativeTimestamp,
} from '../../../utils/dateUtils';
import HuddleIcon from '../../icons/HuddleIcon';
import AIAgentIcon from '../../icons/AIAgentIcon';
import { getEmojiFontSizeClass } from '../../../utils/emojiUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  ChannelVisibility,
  ChannelScopeType,
  MessageType,
  parseForwardedMessageXml,
  parseTicketMd,
} from '@xyne/shared';
import { channelService } from '../../../services/Chat/channelService';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../../hooks/useZero';
import { v4 as uuidv4 } from 'uuid';
import { mutators } from '../../../zero/mutators';
import { InputBox } from '../../ui/InputBox';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import { ForwardMessageFormProps, ForwardTarget, SelectionMode } from './ForwardMessageModal.types';
import { toast } from 'sonner';
import { subscribeSendLifecycle } from '@xyne/shared/messages';
import {
  getDMParticipantIdsToFetch,
  getDMNames,
  parseDMParticipantIds,
} from '../ChatDirectory/ChatDirectory.utils';
import { Combobox } from '../../ui/Combobox/Combobox';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
import { usePlatform } from '../../../hooks/usePlatform';
import { queries } from '../../../zero/queries';
import { useQuery } from '../../../hooks/useQuery';
import { VisibleChannel } from '../../../machines/stateMachine';
import { logger, Event } from '../../../utils/logger';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { RecordingShareContent } from '../../ui/MessageBubble/RecordingShareContent';
import { useRecordingShareMessage } from '../../ui/MessageBubble/recordingShareMessage';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { fetchChannelClawAgents } from '../../../services/channelClawAgentService';
import { useCacConfig } from '@xyne/shared/hooks';
import {
  useAgentConversationPreview,
  useShareAgentConversation,
  useShareAgentConversationStatus,
} from '../../../hooks/useShareAgentConversation';
import type { ShareApiError } from '../../../services/claw/shareAgentConversationService';
import {
  buildConversationShareSubmission,
  canShareWholeConversation,
  isShareableTarget,
  type ForwardMode,
} from './forwardMode';

/**
 * ForwardMessageForm component allows users to forward a message to channels or users.
 * It provides search functionality for finding recipients and an optional message field.
 * Users can select either a single channel OR multiple users.
 *
 * This component should be rendered inside a Dialog.
 */
export const ForwardMessageForm: React.FC<ForwardMessageFormProps> = ({
  message,
  channelId,
  channelScopeType,
  onCancel,
  onSuccess,
}) => {
  const { isMobile } = usePlatform();
  const [selectedTargets, setSelectedTargets] = useState<ForwardTarget[]>([]);
  const [isInitialOpen, setIsInitialOpen] = useState(!isMobile); // Don't show initial suggestions on mobile
  const [comboboxOpen, setComboboxOpen] = useState(!isMobile); // Don't auto-open dropdown on mobile
  const comboboxInputRef = useRef<HTMLInputElement>(null);
  const inputBoxRef = useRef<InputBoxHandle>(null);
  const navigate = useNavigate();
  const zero = useZero();
  const [forwardMode, setForwardMode] = useState<ForwardMode>('message');
  const [addAgent, setAddAgent] = useState(true);
  const [shareOperationId, setShareOperationId] = useState(() => uuidv4());
  const channelAgentsQuery = useReactQuery({
    queryKey: ['channel-claw-agents', channelId],
    queryFn: () => fetchChannelClawAgents(channelId),
    enabled: channelScopeType === ChannelScopeType.DM,
    staleTime: 30_000,
  });
  const channelAgents = channelAgentsQuery.data ?? [];
  const dmAgent = channelAgents.length === 1 ? channelAgents[0] : undefined;
  const { config: sharingEnabled } = useCacConfig<boolean>({
    key: 'share_agent_conversation_enabled',
    fallbackConfig: true,
  });
  const showForwardModes = canShareWholeConversation(
    channelScopeType,
    channelAgents.length,
    sharingEnabled,
  );
  const shareMutation = useShareAgentConversation();
  useEffect(() => {
    if (!showForwardModes && forwardMode === 'conversation') setForwardMode('message');
  }, [forwardMode, showForwardModes]);

  // Focus the combobox input *after* the dialog open animation settles. Focusing
  // it synchronously during open (e.g. via the dialog's auto-focus) gets stolen
  // by the rich-text InputBox mounting, which blurs the combobox — that blur both
  // closes the popup (base-ui onOpenChange) and trips onBlur → setIsInitialOpen(false),
  // wiping out the initial suggestions. Deferring the focus avoids that race.
  useEffect(() => {
    const timeout = setTimeout(() => {
      comboboxInputRef.current?.focus();
    }, 600);
    return () => clearTimeout(timeout);
  }, []);

  // Query the source conversation to get ticket_md — used as a content fallback
  // for desk-ticket messages whose message.content is stored as '' (email body
  // lives in the email table, not in message.content).
  // Only fire when content is empty; disabled otherwise to avoid unnecessary subscriptions.
  const needsConversationQuery = !message.content;
  const [sourceConversation] = useQuery(
    queries.getConversationById({
      conversationId: message.conversationId,
    }),
    { enabled: needsConversationQuery },
  );

  // Initialize form with useForm hook
  const form = useForm({
    defaultValues: {
      optionalMessageHtml: '',
      optionalMessageText: '',
    },
    onSubmit: async ({ value }) => {
      if (selectedTargets.length === 0) return;

      const firstTarget = selectedTargets[0];
      if (!firstTarget) return;

      if (forwardMode === 'conversation') {
        const isShareDestination =
          firstTarget.type === 'channel' || firstTarget.type === 'group_dm';
        if (!isShareDestination || !dmAgent) return;
        try {
          const result = await shareMutation.mutateAsync(
            buildConversationShareSubmission(
              firstTarget.id,
              dmAgent.agentSlug,
              message.conversationId,
              addAgent && (shareStatus?.canAddAgent ?? false),
              true,
              shareOperationId,
              value.optionalMessageText.trim() ? value.optionalMessageHtml : '',
            ),
          );
          logger.info(Event.MESSAGE_FORWARDED, {
            originalMessageId: message.messageId,
            targetType: firstTarget.type,
            targetChannelId: firstTarget.id,
            forwardMode: 'conversation',
          });
          const isGroupDmTarget = firstTarget.type === 'group_dm';
          const targetKind = isGroupDmTarget ? 'group' : 'channel';
          const targetLabel = isGroupDmTarget ? firstTarget.name : `#${firstTarget.name}`;
          if (result.reusedExisting)
            toast.info(`This conversation was already shared to that ${targetKind}.`);
          else toast.success(`Shared ${result.sharedMessageCount} message(s) to ${targetLabel}`);
          onSuccess?.();
          void navigate(`/chat/dir/${firstTarget.id}`);
        } catch (error) {
          const apiError = (error as { response?: { data?: ShareApiError } })?.response?.data;
          logger.error(Event.MESSAGE_FORWARD_FAILED, {
            originalMessageId: message.messageId,
            targetType: firstTarget.type,
            targetChannelId: firstTarget.id,
            forwardMode: 'conversation',
            error: error instanceof Error ? error.message : String(error),
          });
          if (
            apiError?.code === 'RESHARE_CONFIRMATION_REQUIRED' ||
            apiError?.code === 'NO_NEW_MESSAGES'
          ) {
            await shareStatusQuery.refetch();
          }
          toast.error(apiError?.error ?? 'Failed to share conversation. Please try again.');
        }
        return;
      }

      if (firstTarget.type === 'channel') {
        // Forward to channel using mutator
        const conversationId = uuidv4();
        const messageId = uuidv4();
        const timestamp = Date.now();

        try {
          // Fire without awaiting (like sendMessage) and observe the outcome below.
          const mutation = zero.mutate(
            mutators.conversations.forwardMessage({
              targetChannelId: firstTarget.id,
              originalMessageId: message.messageId,
              optionalMessage: value.optionalMessageText.trim()
                ? value.optionalMessageHtml
                : undefined,
              conversationId,
              messageId,
              timestamp,
              conversationParticipantId: uuidv4(),
            }),
          );

          // Show success message
          logger.info(Event.MESSAGE_FORWARDED, {
            originalMessageId: message.messageId,
            targetType: 'channel',
            targetChannelId: firstTarget.id,
          });
          toast.success('Message forwarded', {
            description: `Message sent to #${firstTarget.name}`,
            duration: 3000,
          });

          // Reset form and close modal
          form.reset();
          setSelectedTargets([]);
          inputBoxRef.current?.clearContent();
          onSuccess?.();

          // Navigate to the channel
          void navigate(`/chat/dir/${firstTarget.id}`);

          // Surface a real mutator rejection; transient zero errors are ignored
          // since Zero still persists those on reconnect.
          subscribeSendLifecycle(mutation, () => {
            logger.error(Event.MESSAGE_FORWARD_FAILED, {
              originalMessageId: message.messageId,
              targetType: 'channel',
              targetChannelId: firstTarget.id,
            });
            toast.error('Failed to forward message', {
              description: `Please try again.`,
              duration: 3000,
            });
          });
        } catch (error) {
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to forward message via mutator:'),
            error: error,
          });
          logger.error(Event.MESSAGE_FORWARD_FAILED, {
            originalMessageId: message.messageId,
            targetType: 'channel',
            targetChannelId: firstTarget.id,
            error: error instanceof Error ? error.message : String(error),
          });
          toast.error('Failed to forward message', {
            description: `Please try again.`,
            duration: 3000,
          });
        }
        return;
      }

      // Forward to users (or group_dm + additional users) - create DM with forwarded message
      let userIds: string[];
      if (firstTarget.type === 'group_dm') {
        // Combine existing GROUP_DM members + any additionally selected users
        const additionalUserIds = selectedTargets
          .filter((t: ForwardTarget) => t.type === 'user')
          .map((t: ForwardTarget) => t.id);
        userIds = [...(firstTarget.memberIds ?? []), ...additionalUserIds];
      } else {
        userIds = selectedTargets.map((t: ForwardTarget) => t.id);
      }

      // Prepare forwarded message data
      const forwardedMessageData = {
        originalMessageId: message.messageId,
        optionalMessage: value.optionalMessageText.trim() ? value.optionalMessageHtml : undefined,
      };

      try {
        // Call the createDm API with forwarded message
        const response = await channelService.createDm({
          participantIds: userIds,
          forwardedMessage: forwardedMessageData,
        });

        // Show success message
        const targetNames = selectedTargets.map((t: ForwardTarget) => t.name).join(', ');
        logger.info(Event.MESSAGE_FORWARDED, {
          originalMessageId: message.messageId,
          targetType: 'users',
          targetCount: userIds.length,
        });
        toast.success('Message forwarded', {
          description: `Message sent to ${targetNames}`,
          duration: 3000,
        });

        // Reset form and close modal
        form.reset();
        setSelectedTargets([]);
        inputBoxRef.current?.clearContent();
        onSuccess?.();

        // Navigate to the DM channel
        void navigate(`/chat/dir/${response.id}`);
      } catch (error) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to create DM with forwarded message:'),
          error: error,
        });
        logger.error(Event.MESSAGE_FORWARD_FAILED, {
          originalMessageId: message.messageId,
          targetType: 'users',
          targetCount: userIds.length,
          error: error instanceof Error ? error.message : String(error),
        });
        toast.error('Failed to forward message', {
          description: 'Could not create direct message. Please try again.',
          duration: 3000,
        });
      }
    },
  });

  // Get current user and sender info
  const { user: currentUser } = useAuth();
  const sender = useUser(message.senderId);

  // Mention search for @ mentions in optional message
  const { results: mentionResults, searchMentions } = useMentionSearch(channelId);

  // Channel mention search for # mentions in optional message
  const [channelMentionQuery, setChannelMentionQuery] = useState('');
  const channelMentionResults = useChannelSearch(channelMentionQuery, 10);

  const channelMentionItems = useMemo(() => {
    if (!channelMentionResults || channelMentionResults.length === 0) return [];

    // Filter channels to only show DEFAULT scope (exclude DM, GROUP_DM, TICKET, DOCUMENT)
    return channelMentionResults
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description && { description: channel.description }),
        hasAccess: true,
      }));
  }, [channelMentionResults]);

  const handleChannelMentionSearch = (query: string): void => {
    setChannelMentionQuery(query);
  };

  // Check if this is a forwarded message being re-forwarded
  const isReForwarding = message.msgType === MessageType.FORWARDED;

  // Parse forwarded message XML content for re-forwarding
  const forwardedMessageData = useMemo(() => {
    if (isReForwarding) {
      return parseForwardedMessageXml(message.content);
    }
    return null;
  }, [isReForwarding, message.content]);

  // Check if we're using optionalText (affects both content and attachments display)
  const useOptionalText = isReForwarding && !!forwardedMessageData?.optionalText;

  // Compute the preview content for the modal
  // For forwarded messages: show optionalText as main content (if exists), otherwise show forwarded content
  const previewContent = useMemo(() => {
    if (forwardedMessageData) {
      if (useOptionalText) {
        return forwardedMessageData.optionalText;
      }
      return forwardedMessageData.content;
    }
    if (message.content) {
      return message.content;
    }
    // Desk ticket messages store content as '' — fall back to ticket title from ticket_md.
    if (sourceConversation?.ticket_md) {
      const ticketSummary = parseTicketMd(sourceConversation.ticket_md);
      if (ticketSummary?.title) return ticketSummary.title;
    }
    return message.content;
  }, [useOptionalText, forwardedMessageData, message.content, sourceConversation]);
  const recordingShare = useRecordingShareMessage(previewContent);

  const allVisibleChannels = useAllVisibleChannels();
  const allChannels = useAllChannels().map(
    c => allVisibleChannels.find(vc => vc.id === c.id) || ({ ...c } as VisibleChannel),
  ); // Merge visible channel data with all channels
  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);
  const selectedConversationChannel =
    forwardMode === 'conversation' &&
    (selectedTargets[0]?.type === 'channel' || selectedTargets[0]?.type === 'group_dm')
      ? selectedTargets[0]
      : undefined;
  const previewQuery = useAgentConversationPreview({
    agentSlug: dmAgent?.agentSlug,
    sourceConversationId: message.conversationId,
    enabled: forwardMode === 'conversation',
  });
  const preview = previewQuery.data;
  const shareStatusQuery = useShareAgentConversationStatus({
    channelId: selectedConversationChannel?.id,
    agentSlug: dmAgent?.agentSlug,
    sourceConversationId: forwardMode === 'conversation' ? message.conversationId : undefined,
    activePathTipMessageId: preview?.tipMessageId ?? null,
  });
  const shareStatus = shareStatusQuery.data;
  const previewMarkdownComponents = useMemo(
    () => createMarkdownComponents(`share-preview-${message.messageId}`),
    [message.messageId],
  );
  const noNewMessages =
    !!shareStatus && shareStatus.previouslyShared && !shareStatus.hasNewSinceLastShare;
  const agentLabel = dmAgent?.name ?? dmAgent?.agentSlug ?? 'this agent';
  const destinationNoun =
    shareStatus?.channelScopeType === ChannelScopeType.GROUP_DM ? 'group' : 'channel';
  const lastSharedLabel = shareStatus?.lastSharedAt ? (
    <>
      shared it{' '}
      <Tooltip content={formatFullTimestamp(new Date(shareStatus.lastSharedAt))} side='top'>
        <span className='underline decoration-dotted underline-offset-2'>
          {formatRelativeTime(new Date(shareStatus.lastSharedAt))}
        </span>
      </Tooltip>
    </>
  ) : (
    'shared it here'
  );
  const isReShare = !!shareStatus?.previouslyShared && !noNewMessages;
  const conversationCanSubmit =
    forwardMode !== 'conversation' ||
    (!!selectedConversationChannel && !!shareStatus && !noNewMessages && !shareMutation.isPending);
  const confirmedForChannelId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (confirmedForChannelId.current === selectedConversationChannel?.id) return;
    confirmedForChannelId.current = selectedConversationChannel?.id;
    setAddAgent(true);
  }, [selectedConversationChannel?.id]);

  const handleForwardModeChange = (nextMode: ForwardMode): void => {
    setForwardMode(nextMode);
    setSelectedTargets([]);
    form.reset();
    inputBoxRef.current?.clearContent();
    setAddAgent(true);
    setShareOperationId(uuidv4());
    setInputValue('');
    setIsInitialOpen(true);
    setComboboxOpen(true);
    setTimeout(() => comboboxInputRef.current?.focus(), 0);
  };

  // Determine current selection mode based on selected targets
  const selectionMode: SelectionMode = useMemo(() => {
    if (selectedTargets.length === 0) return 'none';
    const firstTarget = selectedTargets[0];
    if (firstTarget?.type === 'channel') return 'channel';
    if (firstTarget?.type === 'group_dm') return 'group_dm';
    return 'users';
  }, [selectedTargets]);

  // Get IDs of already selected users to filter them out
  const selectedUserIds = useMemo(() => {
    return new Set(
      selectedTargets
        .filter((t: ForwardTarget) => t.type === 'user')
        .map((t: ForwardTarget) => t.id),
    );
  }, [selectedTargets]);

  // Total effective member count for the 9-person cap.
  // In 'group_dm' mode: GROUP_DM members + any additionally selected users.
  // In 'users' mode: just the selected user targets.
  const totalMemberCount = useMemo(() => {
    if (selectionMode === 'group_dm') {
      const groupDmTarget = selectedTargets.find(t => t.type === 'group_dm');
      const groupMemberCount = groupDmTarget?.memberIds?.length ?? 0;
      const additionalUserCount = selectedTargets.filter(t => t.type === 'user').length;
      return groupMemberCount + additionalUserCount;
    }
    return selectedTargets.filter(t => t.type === 'user').length;
  }, [selectionMode, selectedTargets]);

  const handleRemoveTarget = (targetId: string): void => {
    setSelectedTargets((prev: ForwardTarget[]) =>
      prev.filter((t: ForwardTarget) => t.id !== targetId),
    );
    setInputValue('');
    setTimeout(() => comboboxInputRef.current?.focus(), 0);
  };

  const meta = (message.metadata || {}) as Record<string, unknown>;
  const contentStr = typeof message.content === 'string' ? message.content : '';

  const isCallMessage =
    message.msgType === MessageType.SYSTEM &&
    (meta['isCallMessage'] === true ||
      meta['callId'] !== undefined ||
      /started a call|Call ended|joined the call/i.test(contentStr));

  const getGroupDMParticipants = (channel: { name: string; scopeType: ChannelScopeType }) => {
    const otherIds = parseDMParticipantIds(channel).filter(id => id !== currentUser?.id);
    return otherIds
      .map(id => allUsers.find(u => u.id === id))
      .filter((user): user is (typeof allUsers)[number] => user !== undefined);
  };

  const getGroupDMLabel = (channel: { name: string; scopeType: ChannelScopeType }): string => {
    const participants = getGroupDMParticipants(channel);
    return participants.map(user => getUserDisplayName(user)).join(', ');
  };

  const getGroupDMBadgeLabel = (channel: { name: string; scopeType: ChannelScopeType }): string => {
    const MAX_SHOWN = 3;
    const participants = getGroupDMParticipants(channel);
    if (participants.length <= MAX_SHOWN) {
      return participants.map(user => getUserDisplayName(user)).join(', ');
    }
    const shown = participants
      .slice(0, MAX_SHOWN)
      .map(user => getUserDisplayName(user))
      .join(', ');
    return `${shown} +${participants.length - MAX_SHOWN} more`;
  };

  const getGroupDMLeftSlot = (channel: {
    name: string;
    scopeType: ChannelScopeType;
  }): React.ReactNode => {
    const participants = getGroupDMParticipants(channel);
    return (
      <div className='relative'>
        <Users className='w-3.5 h-3.5 text-muted-foreground' />
        <span className='absolute -bottom-1 -right-1.5 text-[10px] leading-none font-medium bg-muted text-muted-foreground rounded-full w-3 h-3 flex items-center justify-center'>
          {participants.length}
        </span>
      </div>
    );
  };

  const getGroupDMTooltip = (channel: {
    name: string;
    scopeType: ChannelScopeType;
  }): React.ReactNode => {
    const MAX_SHOWN = 3;
    const participants = getGroupDMParticipants(channel);
    if (participants.length <= MAX_SHOWN) return null;
    return (
      <div className='max-w-[200px] flex flex-wrap gap-x-1 gap-y-0.5'>
        {participants.map((u, i) => (
          <span key={u.id}>
            {getUserDisplayName(u)}
            {i < participants.length - 1 ? ',' : ''}
          </span>
        ))}
      </div>
    );
  };

  const getChannelIcon = (channelId: string): React.ReactNode => {
    const channel = allChannels.find(c => c.id === channelId);
    const isPrivate = channel?.visibility === ChannelVisibility.PRIVATE;
    return isPrivate ? <Lock className='w-4 h-4' /> : <Hash className='w-4 h-4' />;
  };

  // Label for a user option, marking the current user as "(You)" — forwarding to
  // yourself is a valid action (creates / reuses the self-DM, a.k.a. notes to self).
  const getForwardUserLabel = (user: {
    id: string;
    name?: string | null;
    email?: string | null;
    displayName?: string | null;
  }): string => {
    const displayName = getUserDisplayName(user);
    return user.id === currentUser?.id ? `${displayName} (You)` : displayName;
  };

  const [inputValue, setInputValue] = useState<string>('');
  const trimmedInputValue = inputValue.trim();
  // Active people ranked by matchesAllTokens + MFU affinity + DM recency (same trio as cmd+K).
  const rankedUsers = useRankedActivePeople(trimmedInputValue, 20);
  const channelsSuggestions = useChannelSearch(trimmedInputValue, 5);
  const affinityVersion = useAffinityCallback();
  const dropdownListItems = useMemo(() => {
    // Re-read affinity once weights load (channel weights read imperatively by the rankers below).
    void affinityVersion;
    // Show default suggestions on initial modal open with empty input
    if (!inputValue.trim()) {
      if (isInitialOpen) {
        const defaults: DropdownListItemType[] = [];

        // Recent 1:1 DMs ranked by MFU affinity, recency tie-break (up to 5)
        const recentDMs =
          forwardMode === 'message'
            ? rankChannelsByAffinity(
                allChannels.filter(channel => channel.scopeType === ChannelScopeType.DM),
              ).slice(0, 5)
            : [];

        recentDMs.forEach(channel => {
          // Self-DM ("notes to self") — only the current user is a participant.
          // Surface it just like any other recent DM, labeled "(You)".
          const allParticipants = parseDMParticipantIds(channel);
          const isSelfDM = allParticipants.length === 1 && allParticipants[0] === currentUser?.id;
          if (isSelfDM) {
            const selfUser = allUsers.find(u => u.id === currentUser?.id);
            if (selfUser) {
              defaults.push({
                leftSlot: <Avatar userId={selfUser.id} size='sm' />,
                label: getForwardUserLabel(selfUser),
                description: selfUser.email,
                value: selfUser.id,
              });
            }
            return;
          }

          const participantIds = getDMParticipantIdsToFetch(channel, currentUser?.id || '');
          const otherUser = allUsers.find(user => participantIds.includes(user.id));

          if (otherUser && otherUser.id !== currentUser?.id) {
            defaults.push({
              leftSlot: <Avatar userId={otherUser.id} size='sm' />,
              label: getUserDisplayName(otherUser),
              description: otherUser.email,
              value: otherUser.id,
            });
          }
        });

        // Recent GROUP_DMs ranked by MFU affinity, recency tie-break (up to 5)
        const recentGroupDMs = rankChannelsByAffinity(
          allChannels.filter(
            channel =>
              channel.scopeType === ChannelScopeType.GROUP_DM &&
              (forwardMode === 'message' || isShareableTarget(channel)),
          ),
        ).slice(0, 5);

        recentGroupDMs.forEach(channel => {
          const label = getGroupDMLabel(channel);
          if (label) {
            defaults.push({
              leftSlot: getGroupDMLeftSlot(channel),
              label,
              value: channel.id,
              tooltip: getGroupDMTooltip(channel),
            });
          }
        });

        // Recent DEFAULT channels ranked by MFU affinity, recency tie-break (up to 5)
        const recentChannels = rankChannelsByAffinity(
          allChannels.filter(channel => isShareableTarget(channel)),
        ).slice(0, 5);

        recentChannels.forEach(channel => {
          defaults.push({
            leftSlot:
              channel.visibility === ChannelVisibility.PUBLIC ? (
                <Hash className='w-3.5 h-3.5 text-muted-foreground' />
              ) : (
                <Lock className='w-3.5 h-3.5 text-muted-foreground' />
              ),
            label: channel.name,
            value: channel.id,
          });
        });

        return defaults;
      }
      return [];
    }

    // In group_dm mode, also exclude users already in the selected GROUP_DM
    const groupDmMemberIds =
      selectionMode === 'group_dm'
        ? new Set(selectedTargets.find(t => t.type === 'group_dm')?.memberIds ?? [])
        : new Set<string>();

    const suggestedUsers: DropdownListItemType[] =
      forwardMode === 'conversation'
        ? []
        : rankedUsers
            .filter(
              currUser =>
                // Self is a valid target only as a solo "notes to self" pick. Hide it once
                // anything else is selected (in a DM/group the current user is implicit).
                !(currUser.id === currentUser?.id && selectionMode !== 'none') &&
                !selectedUserIds.has(currUser.id) &&
                !groupDmMemberIds.has(currUser.id),
            )
            // Bound the visible list: rankUsersWithMfu can recover weighted matches past the 20 cap.
            .slice(0, 20)
            .map(currUser => ({
              leftSlot: <Avatar userId={currUser.id} size='sm' />,
              label: getForwardUserLabel(currUser),
              description: currUser.email,
              value: currUser.id,
            }));

    const suggestedChannels: DropdownListItemType[] = rankChannelsByAffinity(
      channelsSuggestions.filter(currChannel => isShareableTarget(currChannel)),
    ).map(currChannel => ({
      leftSlot:
        currChannel.visibility === ChannelVisibility.PUBLIC ? (
          <Hash className='w-3.5 h-3.5 text-muted-foreground' />
        ) : (
          <Lock className='w-3.5 h-3.5 text-muted-foreground' />
        ),
      label: currChannel.name,
      value: currChannel.id,
    }));

    // Full-name participant matching + MFU affinity via the shared cmd+K group-DM matcher
    // (getDMNames(...).search feeds both displayName and raw name per participant).
    const groupDmChannels = allChannels.filter(
      channel =>
        channel.scopeType === ChannelScopeType.GROUP_DM &&
        (forwardMode === 'message' || isShareableTarget(channel)),
    );
    const suggestedGroupDMs: DropdownListItemType[] = filterChannelsBySearchableNames(
      groupDmChannels.map(channel => ({
        channel,
        searchNames: getDMNames(channel, currentUser?.id ?? '', usersById).search,
      })),
      trimmedInputValue,
    )
      .slice(0, 5)
      .map(({ channel }) => ({
        leftSlot: getGroupDMLeftSlot(channel),
        label: getGroupDMLabel(channel),
        value: channel.id,
        tooltip: getGroupDMTooltip(channel),
      }));

    if (selectionMode === 'none') {
      return [...suggestedUsers, ...suggestedGroupDMs, ...suggestedChannels];
    } else if (selectionMode === 'channel') {
      return suggestedChannels;
    } else if (selectionMode === 'group_dm') {
      // Only show individual users — no channels, no group DMs
      return suggestedUsers;
    }
    return suggestedUsers;
  }, [
    inputValue,
    trimmedInputValue,
    selectedUserIds,
    isInitialOpen,
    rankedUsers,
    channelsSuggestions,
    selectionMode,
    selectedTargets,
    allChannels,
    allUsers,
    usersById,
    currentUser,
    affinityVersion,
    forwardMode,
  ]);

  const onInputValueChangeHandler = (queryString: string) => {
    setInputValue(queryString);
    if (queryString.trim().length > 0 && isInitialOpen) {
      setIsInitialOpen(false);
    }
  };

  const onValueChangeHandler = (selectedValue: string | null) => {
    if (!selectedValue) return;

    // Check if the selected value is a user
    const selectedUser = allUsers.find(u => u.id === selectedValue);
    if (selectedUser) {
      const newTarget: ForwardTarget = {
        type: 'user',
        id: selectedUser.id,
        name: getForwardUserLabel(selectedUser),
      };
      setSelectedTargets((prev: ForwardTarget[]) => [...prev, newTarget]);
      setInputValue('');
      setIsInitialOpen(false);
      comboboxInputRef.current?.focus();
      return;
    }

    // Check if the selected value is a channel
    const selectedChannel = allChannels.find(c => c.id === selectedValue);
    if (selectedChannel) {
      if (forwardMode === 'conversation' && !isShareableTarget(selectedChannel)) return;
      if (selectedChannel.scopeType === ChannelScopeType.GROUP_DM) {
        const memberIds = parseDMParticipantIds(selectedChannel).filter(
          id => id !== currentUser?.id,
        );
        const newTarget: ForwardTarget = {
          type: 'group_dm',
          id: selectedChannel.id,
          name: getGroupDMBadgeLabel(selectedChannel),
          memberIds,
        };
        setSelectedTargets([newTarget]);
      } else {
        const newTarget: ForwardTarget = {
          type: 'channel',
          id: selectedChannel.id,
          name: selectedChannel.name,
        };
        setSelectedTargets([newTarget]);
      }
      setInputValue('');
      setIsInitialOpen(false);
      return;
    }
  };

  return (
    <form
      data-id='forward-message-form'
      data-testid='forward-message-form'
      onSubmit={e => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {/* Header */}
      <div className='flex items-center justify-between px-6 pt-6 pb-4 border-b border-border'>
        <h2 className='text-lg font-semibold text-foreground'>
          {forwardMode === 'conversation' ? 'Share conversation' : 'Forward message'}
        </h2>
        <button
          type='button'
          className='rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2'
          onClick={onCancel}
          data-track-category='FORWARD_MESSAGE_MODAL'
          data-track-name='CLOSE_FORWARD_MODAL'
        >
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </button>
      </div>

      {showForwardModes && (
        <div
          className='grid grid-cols-2 gap-2 px-6 pt-4'
          role='radiogroup'
          aria-label='Forward mode'
        >
          <button
            type='button'
            role='radio'
            aria-checked={forwardMode === 'message'}
            className={`rounded-md border px-3 py-2 text-sm ${forwardMode === 'message' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}
            onClick={() => handleForwardModeChange('message')}
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name='SELECT_THIS_MESSAGE_MODE'
          >
            This message
          </button>
          <button
            type='button'
            role='radio'
            aria-checked={forwardMode === 'conversation'}
            className={`rounded-md border px-3 py-2 text-sm ${forwardMode === 'conversation' ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}
            onClick={() => handleForwardModeChange('conversation')}
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name='SELECT_WHOLE_CONVERSATION_MODE'
          >
            Whole conversation
          </button>
        </div>
      )}

      <div className='px-6 py-4 space-y-2'>
        {selectedTargets.length > 0 && (
          <div className='flex flex-wrap gap-2 mb-2'>
            {selectedTargets.map((target: ForwardTarget) => {
              const channel = allChannels.find(c => c.id === target.id);
              const isGroupDM = channel?.scopeType === ChannelScopeType.GROUP_DM;
              const badgeTooltip = isGroupDM ? getGroupDMTooltip(channel) : undefined;
              return (
                <Badge key={target.id} variant='primary' className='flex items-center gap-1.5 pr-1'>
                  {target.type === 'channel' ? (
                    <span className='flex items-center gap-1'>
                      {getChannelIcon(target.id)}
                      <span className='text-xs'>{target.name}</span>
                    </span>
                  ) : target.type === 'group_dm' && badgeTooltip ? (
                    <Tooltip
                      content={badgeTooltip}
                      side='top'
                      sideOffset={6}
                      delayDuration={400}
                      providerProps={{ disableHoverableContent: true, children: undefined }}
                    >
                      <span className='text-xs cursor-default'>{target.name}</span>
                    </Tooltip>
                  ) : (
                    <span className='text-xs'>{target.name}</span>
                  )}
                  <button
                    type='button'
                    onClick={() => handleRemoveTarget(target.id)}
                    className='rounded-full p-0.5 transition-colors'
                    aria-label={`Remove ${target.name}`}
                    data-track-category='FORWARD_MESSAGE_MODAL'
                    data-track-name='REMOVE_FORWARD_TARGET'
                    data-track-metadata={JSON.stringify({
                      targetId: target.id,
                      targetName: target.name,
                    })}
                  >
                    <X className='h-3 w-3' />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
        {(forwardMode === 'conversation'
          ? selectedTargets.length === 0
          : selectionMode !== 'channel') &&
          totalMemberCount < 9 && (
            <Combobox
              ref={comboboxInputRef}
              label={forwardMode === 'conversation' ? 'Share to' : 'Forward to'}
              onInputValueChange={onInputValueChangeHandler}
              onValueChange={onValueChangeHandler}
              queryString={inputValue}
              placeholder={
                forwardMode === 'conversation'
                  ? 'Search channels or group DMs...'
                  : selectionMode === 'users' || selectionMode === 'group_dm'
                    ? 'Add more users...'
                    : 'Search channels or users...'
              }
              items={dropdownListItems}
              value={null}
              hintText={
                forwardMode === 'conversation'
                  ? 'Select an active channel or group DM to share this conversation'
                  : 'Select a channel or one or more users to forward this message'
              }
              onBlur={() => setIsInitialOpen(false)}
              open={comboboxOpen}
              onOpenChange={setComboboxOpen}
              autoHighlight={true}
            />
          )}
        {(selectionMode === 'users' || selectionMode === 'group_dm') && totalMemberCount >= 9 && (
          <p className='text-xs text-muted-foreground mt-1.5'>
            Maximum 9 recipients reached. Remove someone to add another.
          </p>
        )}
        {selectionMode === 'channel' && (
          <p className='text-xs text-muted-foreground mt-1.5'>
            {forwardMode === 'conversation'
              ? 'Conversation will be shared to the selected destination'
              : 'Message will be forwarded to the selected channel'}
          </p>
        )}
      </div>
      <div className='px-6 py-4 space-y-4'>
        {forwardMode === 'conversation' &&
          selectedConversationChannel &&
          shareStatusQuery.isError && (
            <div className='rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              {(shareStatusQuery.error as unknown as { response?: { data?: ShareApiError } })
                ?.response?.data?.error ?? 'This channel cannot receive the shared conversation.'}
            </div>
          )}
        {forwardMode === 'conversation' &&
          selectedConversationChannel &&
          shareStatusQuery.isLoading && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='animate-spin' size={14} /> Checking channel…
            </div>
          )}
        {forwardMode === 'conversation' && selectedConversationChannel && shareStatus && (
          <div className='flex flex-col gap-3'>
            {shareStatus.previouslyShared && (
              <div className='rounded-md bg-warning/15 px-3 py-2 text-sm text-warning'>
                {noNewMessages ? (
                  <div className='flex flex-col'>
                    <span className='text-xs font-medium'>Nothing new to share</span>
                    <span className='text-xs'>
                      This conversation hasn&apos;t changed since you {lastSharedLabel}.
                    </span>
                  </div>
                ) : (
                  <div className='flex flex-col'>
                    <span className='text-xs font-medium'>Already shared here</span>
                    <span className='text-xs'>
                      You {lastSharedLabel}. Sharing again creates a new, separate thread.
                    </span>
                  </div>
                )}
              </div>
            )}
            {shareStatus.channelScopeType === ChannelScopeType.GROUP_DM ? (
              <div className='text-xs text-warning'>
                Only members of this group can view this shared conversation.
              </div>
            ) : shareStatus.channelVisibility === 'PRIVATE' ? (
              <div className='text-xs text-warning'>
                Only members of this channel can view this shared conversation.
              </div>
            ) : (
              <div className='text-xs text-warning'>
                Everyone in the workspace can view this shared conversation.
              </div>
            )}
            <div className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                data-track-category='FORWARD_MESSAGE_MODAL'
                data-track-name='ADD_AGENT_WHILE_SHARING_CONVERSATION'
                disabled={!shareStatus.canAddAgent}
                checked={shareStatus.agentInChannel || (shareStatus.canAddAgent && addAgent)}
                onChange={event => setAddAgent(event.target.checked)}
              />
              <span className={shareStatus.canAddAgent ? undefined : 'text-muted-foreground'}>
                {shareStatus.agentInChannel
                  ? `${agentLabel} is already present in the ${destinationNoun}.`
                  : shareStatus.canAddAgent
                    ? `Also add ${agentLabel} to this ${destinationNoun}`
                    : shareStatus.agentInstalled
                      ? `You do not have permission to add ${agentLabel} to this ${destinationNoun}.`
                      : 'This agent is not installed as an app and cannot be added to a channel.'}
              </span>
            </div>
          </div>
        )}
        {/* Optional message with InputBox */}
        <div
          onKeyDownCapture={e => {
            if (e.key === 'Enter' && !e.shiftKey && selectedTargets.length > 0) {
              if (inputBoxRef.current?.isSuggestionOpen()) return;
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }
          }}
        >
          <label
            htmlFor='forward-message-optional'
            className='block text-sm font-medium text-foreground mb-1.5'
          >
            Add a message (optional)
          </label>
          <InputBox
            ref={inputBoxRef}
            id='forward-message-optional'
            placeholder={
              forwardMode === 'conversation'
                ? 'Add a note for the people you are sharing with...'
                : 'Add a note to the forwarded message...'
            }
            onSendMessage={() => {
              // Handled by the wrapper div's onKeyDown
            }}
            onContentChange={(html: string, text: string) => {
              form.setFieldValue('optionalMessageHtml', html);
              form.setFieldValue('optionalMessageText', text);
            }}
            {...(forwardMode === 'message'
              ? {
                  mentionItems: mentionResults,
                  onMentionSearch: searchMentions,
                  channelItems: channelMentionItems,
                  onChannelSearch: handleChannelMentionSearch,
                }
              : {})}
            features={{
              richText: true,
              mentions: forwardMode === 'message',
              commands: false,
              fileAttachments: false,
              emojiPicker: true,
            }}
            showTypingIndicator={false}
            disabled={form.state.isSubmitting}
            hideSendButton
          />
        </div>

        {forwardMode === 'conversation' && (
          <div>
            <span className='block text-sm font-medium text-foreground mb-1.5'>
              Conversation preview
            </span>
            <div className='bg-muted rounded-md p-3 border border-border max-h-[200px] overflow-y-auto'>
              {previewQuery.isLoading ? (
                <span className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <Loader2 className='animate-spin' size={14} /> Loading conversation…
                </span>
              ) : preview ? (
                <div className='flex flex-col gap-2'>
                  {preview.turns.map((turn, index) => (
                    <div key={`${turn.role}-${index}`} className='flex gap-3'>
                      <div className='flex-shrink-0'>
                        {turn.userId ? (
                          <Avatar userId={turn.userId} size='md' />
                        ) : (
                          <div className='flex h-10 w-10 items-center justify-center rounded-md bg-accent'>
                            <AIAgentIcon />
                          </div>
                        )}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <h4 className='text-sm font-semibold text-foreground'>{turn.name}</h4>
                        <MarkdownMessageRenderer
                          content={turn.content}
                          markdownComponents={previewMarkdownComponents}
                        />
                      </div>
                    </div>
                  ))}
                  {preview.previewTruncated ? (
                    <span className='text-xs text-muted-foreground'>
                      …and more. The full conversation will be shared.
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className='text-sm text-muted-foreground'>
                  This conversation could not be loaded.
                </span>
              )}
            </div>
          </div>
        )}
        {forwardMode === 'message' && (
          <>
            {/* Message preview */}
            <div>
              <span className='block text-sm font-medium text-foreground mb-1.5'>
                Message preview
              </span>
              <div className='bg-muted rounded-md p-3 border border-border max-h-[200px] overflow-y-auto'>
                <div className='flex gap-3'>
                  <div className='flex-shrink-0'>
                    {isCallMessage ? (
                      <div className='w-10 h-10 rounded-md flex items-center justify-center bg-accent'>
                        <HuddleIcon color='hsl(var(--muted-foreground))' size={20} />
                      </div>
                    ) : (
                      <Avatar userId={message.senderId} size='md' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-baseline gap-2 mb-1'>
                      <h4 className='text-sm font-semibold text-foreground'>
                        {isCallMessage ? 'Xyne Call' : getUserDisplayName(sender)}
                      </h4>
                      <span className='text-xs text-muted-foreground'>
                        {formatRelativeTimestamp(message.createdAt)}
                      </span>
                    </div>
                    {recordingShare ? (
                      <RecordingShareContent
                        recordingShare={recordingShare}
                        className='flex min-w-0 flex-col gap-1'
                        renderNote={noteHtml => (
                          <div
                            className={`text-foreground whitespace-pre-wrap break-words ${getEmojiFontSizeClass(noteHtml)}`}
                          >
                            <RenderMessageWithHTML message={noteHtml} />
                          </div>
                        )}
                      />
                    ) : previewContent ? (
                      <div
                        className={`text-foreground whitespace-pre-wrap break-words ${getEmojiFontSizeClass(previewContent)}`}
                      >
                        <RenderMessageWithHTML message={previewContent} />
                      </div>
                    ) : null}
                    {/* Attachments - hide when using optionalText (it's either optionalText OR content with attachments) */}
                    {!useOptionalText && message.attachments && message.attachments.length > 0 && (
                      <div className='mt-2'>
                        <div className='flex flex-wrap gap-2'>
                          {message.attachments.map(attachment => (
                            <div key={attachment.id} className='flex-shrink-0'>
                              <MessageAttachment attachment={attachment} compact />
                            </div>
                          ))}
                        </div>
                        <p className='text-xs text-muted-foreground mt-1'>
                          {message.attachments.length}{' '}
                          {message.attachments.length === 1 ? 'attachment' : 'attachments'} will be
                          forwarded
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        {/* Action buttons */}
        <div className='flex justify-end gap-3 pt-2'>
          <Button
            variant='secondary'
            type='button'
            onClick={onCancel}
            disabled={form.state.isSubmitting}
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name='CANCEL_FORWARD'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            loading={form.state.isSubmitting}
            disabled={
              selectedTargets.length === 0 || form.state.isSubmitting || !conversationCanSubmit
            }
            data-track-category='FORWARD_MESSAGE_MODAL'
            data-track-name={
              forwardMode === 'conversation' ? 'SHARE_WHOLE_CONVERSATION' : 'FORWARD_MESSAGE'
            }
            data-track-metadata={JSON.stringify({ targetCount: selectedTargets.length })}
            trackId='forward_message'
          >
            {form.state.isSubmitting || shareMutation.isPending
              ? forwardMode === 'conversation'
                ? 'Sharing...'
                : 'Forwarding...'
              : forwardMode === 'conversation'
                ? isReShare
                  ? 'Share again'
                  : 'Share conversation'
                : 'Forward'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default ForwardMessageForm;
