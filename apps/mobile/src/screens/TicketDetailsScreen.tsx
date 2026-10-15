import {
  BoardType,
  deriveEtaManagementView,
  LookupType,
  parseBoardEtaManagement,
  parseTicketEtaManagement,
  parseTicketMd,
} from '@xyne/shared';
import { format } from 'date-fns';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Copy } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { useCSSVariable } from 'uniwind';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { parseAssigneeRef } from '@/src/features/channel-tickets/utils/parse-assignee-ref';
import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';
import { UnreadCountBadge } from '@/src/components/ui/unread-count-badge';
import { useBoards } from '@/src/hooks/useBoards';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useChannelById, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useSelf, useUser } from '@/src/hooks/useUsers';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useZero } from '@/src/hooks/useZero';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import { cn } from '@/src/utils/cn';
import { normalizeWorkspaceIdForLink } from '@/src/utils/deepLinkWorkspace';
import { haptics } from '@/src/utils/haptics';
import { buildWebTicketLinkFromIds } from '@/src/utils/ticketDeepLink';
import { showMessageToast } from '@/src/utils/toast';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import {
  formatUserGroupDisplayName,
  parseTicketPriority,
  resolveAssigneePickerGroupId,
  resolveTicketUserGroupId,
} from './ticket-details/assignment-utils';
import {
  formatETADisplay,
  getTicketStatusDotClass,
  isStageDeadlineOverdue,
  isTicketDueDateOverdue,
  normalizeTimestamp,
} from './ticket-details/helpers';
import { buildOverviewMetaRows } from './ticket-details/overview-meta-rows';
import {
  buildBoardOptions,
  buildLabelOptions,
  buildStageStatusOptions,
  buildTicketTypeOptions,
  buildUserGroupOptions,
} from './ticket-details/picker-options';
import { firstNonEmptyId, resolveEffectiveTicketId } from './ticket-details/resolve-ticket-ids';
import { runTicketMutation } from './ticket-details/run-ticket-mutation';
import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import { TicketThreadPane } from '@/src/features/chat/v3/screens/TicketThreadPane';
import { OverviewTab } from './ticket-details/tabs/OverviewTab';
import { TicketDetailsPickers } from './ticket-details/ticket-details-pickers';
import { mapAppliedLabels } from './ticket-details/ticket-labels';
import { TicketTabPager, type TicketTab } from './ticket-details/ticket-tab-pager';
import { countThreadUnreadActivities } from './ticket-details/thread-unread';
import { useTicketDetailsEditors } from './ticket-details/use-ticket-details-editors';

type TicketDetailsScreenProps = {
  ticketId: string;
  selectedTab?: TicketTab;
  fallbackChannelId?: string;
  fallbackThreadId?: string;
  targetMessageId?: string;
  from?: string;
  source?: string;
  createdAt?: string;
  openStartedAtMs?: number;
  chatOpenAttemptId?: string;
};

export function TicketDetailsScreen({
  ticketId,
  selectedTab = 'overview',
  fallbackChannelId,
  fallbackThreadId,
  targetMessageId,
  from,
  source,
  createdAt,
  openStartedAtMs,
  chatOpenAttemptId,
}: TicketDetailsScreenProps): ReactElement {
  const router = useRouter();
  const zero = useZero();
  const useV3 = useRef(isChatV3Enabled()).current;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const ticketMetaIconColor = useCSSVariable('--color-ticket-meta-right-text') as string;
  const destructiveColor = (useCSSVariable('--color-destructive') as string) || '#FF4F4F';
  const dueDateTextColor =
    (useCSSVariable('--color-ticket-overview-due-text') as string) || '#c2410c';
  const [activeTab, setActiveTab] = useState<TicketTab>(selectedTab);

  const [fallbackConversation] = useCachedQuery(
    queries.getConversationById({ conversationId: fallbackThreadId ?? '' }),
    { enabled: !!fallbackThreadId },
  );
  const fallbackTicketMd = useMemo(
    () => parseTicketMd(fallbackConversation?.ticket_md ?? null),
    [fallbackConversation?.ticket_md],
  );
  const fallbackTicket = fallbackConversation?.ticket;

  const effectiveTicketId = resolveEffectiveTicketId({
    ticketId,
    fallbackTicketId: fallbackTicket?.id,
    fallbackConversationTicketId: fallbackConversation?.ticketId,
    fallbackTicketMdId: fallbackTicketMd?.id,
  });

  // Label add/remove only mutates related `tagMappings` and does not bump
  // ticket.updatedAt — do not gate this query on updatedAtEnabled.
  const [ticket] = useCachedQuery(queries.ticketDetailsByIdV2({ ticketId: effectiveTicketId }), {
    enabled: !!effectiveTicketId,
  });
  useCachedQuery(queries.attachmentsByTicket({ ticketId: effectiveTicketId }), {
    enabled: !!effectiveTicketId,
  });
  const [unreadActivities] = useCachedQuery(queries.userUnreadActivities());

  const self = useSelf();
  const reporter = useUser(
    ticket?.createdBy ?? fallbackTicket?.createdBy ?? fallbackTicketMd?.createdBy ?? '',
  );

  const rawAssignedTo = ticket
    ? (ticket.assignedTo ?? null)
    : (fallbackTicket?.assignedTo ?? fallbackTicketMd?.assignedTo ?? null);
  const assigneeRef = parseAssigneeRef(rawAssignedTo);
  const assigneeUserId = assigneeRef?.kind === 'user' ? assigneeRef.id : null;
  const assigneeGroupId = assigneeRef?.kind === 'group' ? assigneeRef.id : null;
  const assignee = useUser(assigneeUserId ?? '');
  const userGroups = useUserGroups();
  const assigneeGroupName = useMemo(() => {
    if (!assigneeGroupId) return null;
    return userGroups.find(group => group.id === assigneeGroupId)?.name ?? null;
  }, [assigneeGroupId, userGroups]);
  const assigneeDisplayName =
    assigneeRef?.kind === 'user'
      ? (assignee?.name ?? 'Unknown')
      : assigneeRef?.kind === 'group'
        ? (assigneeGroupName ?? 'Group')
        : 'Unassigned';

  // Authoritative ticket field once hydrated (do not fall through to assignee group).
  const ticketUserGroupId = resolveTicketUserGroupId(
    Boolean(ticket),
    (ticket as { userGroupId?: string | null } | undefined)?.userGroupId,
    (fallbackTicket as { userGroupId?: string | null } | undefined)?.userGroupId,
  );
  // Assignee picker scopes candidates to ticket group, else assignee-as-group.
  const assigneePickerGroupId = resolveAssigneePickerGroupId(ticketUserGroupId, assigneeGroupId);
  const ticketUserGroupName = useMemo(() => {
    if (!ticketUserGroupId) return null;
    return userGroups.find(group => group.id === ticketUserGroupId)?.name ?? null;
  }, [ticketUserGroupId, userGroups]);
  const userGroupDisplayName = formatUserGroupDisplayName(ticketUserGroupName, ticketUserGroupId);
  const userGroupOptions = useMemo(() => buildUserGroupOptions(userGroups), [userGroups]);
  const projectName =
    (ticket as { project?: { name?: string } })?.project?.name ??
    (fallbackTicket as { project?: { name?: string } } | undefined)?.project?.name ??
    '—';
  const projectId =
    ticket?.projectId ??
    (fallbackTicket as { projectId?: string | null } | undefined)?.projectId ??
    '';
  const selectedBoardId =
    ticket?.boardId ?? (fallbackTicket as { boardId?: string | null } | undefined)?.boardId ?? null;

  const [boardDetail] = useCachedQuery(
    queries.boardFullDetailById({ boardId: selectedBoardId ?? '' }),
    { enabled: !!selectedBoardId },
  );
  const { boards, isLoading: isBoardsLoading } = useBoards(projectId || undefined);
  const [boardStages] = useCachedQuery(queries.stagesByBoard({ boardId: selectedBoardId ?? '' }), {
    enabled: !!selectedBoardId,
  });

  const statusOptions = useMemo(() => buildStageStatusOptions(boardStages), [boardStages]);

  const selectedStageName =
    ticket?.stageName ?? fallbackTicket?.stageName ?? fallbackTicketMd?.stageName ?? null;
  const selectedTicketType =
    ticket?.ticketType ??
    (fallbackTicket as { ticketType?: string | null } | undefined)?.ticketType ??
    (fallbackTicketMd as { ticketType?: string | null } | null)?.ticketType ??
    null;
  const selectedPriority = parseTicketPriority(
    ticket?.priority ?? fallbackTicket?.priority ?? fallbackTicketMd?.priority ?? null,
  );
  const appliedLabels = useMemo(() => mapAppliedLabels(ticket?.tagMappings), [ticket?.tagMappings]);
  const labels = appliedLabels.map(label => label.name);
  const selectedLabelValues = useMemo(
    () => appliedLabels.map(label => label.name),
    [appliedLabels],
  );

  const currentStageInfo = useMemo(
    () => (boardStages ?? []).find(stage => stage.name === selectedStageName) ?? null,
    [boardStages, selectedStageName],
  );
  const currentStageEntry = useMemo(
    () => ticket?.stageEtaEntries?.find(entry => entry.stageLeftAt === null) ?? null,
    [ticket?.stageEtaEntries],
  );
  const statusDeadlineMs = normalizeTimestamp(currentStageEntry?.stageEta);

  const editors = useTicketDetailsEditors({
    ticket: ticket
      ? {
          id: ticket.id,
          eta: ticket.eta,
          metadata: ticket.metadata,
          stageEtaEntries: ticket.stageEtaEntries,
        }
      : null,
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
  });

  const [ticketTypeLookups] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
    { enabled: editors.isTypePickerOpen },
  );
  const typeOptions = useMemo(
    () => buildTicketTypeOptions(ticketTypeLookups, selectedTicketType),
    [selectedTicketType, ticketTypeLookups],
  );
  const boardOptions = useMemo(() => buildBoardOptions(boards), [boards]);

  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: projectId || '' }),
    { enabled: editors.isLabelsPickerOpen && !!projectId },
  );
  const labelOptions = useMemo(() => buildLabelOptions(projectTags, labels), [labels, projectTags]);

  const channelId = firstNonEmptyId(
    ticket?.channelId,
    fallbackTicket?.channelId,
    fallbackTicketMd?.channelId,
    fallbackConversation?.channelId,
    fallbackChannelId,
  );
  const channel = useChannelById(channelId);
  const channelDisplayName = useChannelDisplayName(channel, self?.id ?? '');
  const channelName = channel ? channelDisplayName : '—';
  const conversationId = firstNonEmptyId(
    ticket?.conversationId,
    fallbackTicket?.conversationId,
    fallbackTicketMd?.conversationId,
    fallbackConversation?.conversationId,
    fallbackThreadId,
  );

  useEffect(() => {
    setActiveTab(selectedTab);
  }, [selectedTab, ticketId]);

  const statusLabel =
    ticket?.stageName ||
    fallbackTicket?.stageName ||
    fallbackTicketMd?.stageName ||
    ticket?.statusV2 ||
    fallbackTicket?.statusV2 ||
    fallbackTicketMd?.statusV2 ||
    'In Progress';
  const priorityLabel =
    ticket?.priority || fallbackTicket?.priority || fallbackTicketMd?.priority || 'High';
  const etaMs = normalizeTimestamp(ticket?.eta ?? fallbackTicket?.eta ?? fallbackTicketMd?.eta);
  const dueDateShort = etaMs ? format(new Date(etaMs), 'MMM d') : '—';
  const dueDateLabel = etaMs ? formatETADisplay(etaMs) : 'Set Due Date';
  const ticketStatusV2 =
    ticket?.statusV2 ?? fallbackTicket?.statusV2 ?? fallbackTicketMd?.statusV2 ?? '';
  const isDueDateOverdue = isTicketDueDateOverdue(etaMs, ticketStatusV2);
  const etaManagementView = useMemo(() => {
    if (!ticket) return null;
    return deriveEtaManagementView({
      ticketEtaManagement: parseTicketEtaManagement(ticket.metadata),
      boardEtaManagement: parseBoardEtaManagement(
        boardDetail?.metadata ?? null,
        boardDetail?.boardType ?? BoardType.DEFAULT,
      ),
      ticketEta: etaMs,
      ticketStatus: ticketStatusV2,
      now: Date.now(),
    });
  }, [boardDetail?.boardType, boardDetail?.metadata, etaMs, ticket, ticketStatusV2]);

  const dueDateMin = useMemo(() => new Date(), [editors.isDueDatePickerOpen]);
  const showStatusDeadline = !!currentStageInfo?.eta;
  const statusDeadlineLabel = statusDeadlineMs
    ? formatETADisplay(statusDeadlineMs)
    : 'Set Stage Deadline';
  const isStatusDeadlineOverdue = isStageDeadlineOverdue(statusDeadlineMs, ticketStatusV2);
  const statusDeadlineMin = useMemo(() => new Date(), [editors.isStatusDeadlinePickerOpen]);

  const createdAtMs = normalizeTimestamp(
    ticket?.createdAt ??
      fallbackTicket?.createdAt ??
      (fallbackTicketMd as { createdAt?: number | null } | null)?.createdAt,
  );
  const createdAtLabel = createdAtMs ? format(new Date(createdAtMs), 'MMM d, yyyy') : '—';
  const fallbackDescription = fallbackTicket?.description ?? fallbackTicketMd?.description ?? null;
  const title =
    ticket?.title ?? fallbackTicket?.title ?? fallbackTicketMd?.title ?? 'Untitled ticket';
  const description = ticket?.description?.trim()
    ? ticket.description
    : fallbackDescription?.trim()
      ? fallbackDescription
      : 'No description';
  const boardName =
    boardDetail?.name?.trim() ||
    boards.find(board => board.id === selectedBoardId)?.name?.trim() ||
    (ticket as { board?: { name?: string }; boardName?: string })?.board?.name ||
    (ticket as { board?: { name?: string }; boardName?: string })?.boardName ||
    projectName;
  const ticketShortId =
    ticket?.xyneId ??
    fallbackTicket?.xyneId ??
    fallbackTicketMd?.xyneId ??
    effectiveTicketId?.slice(0, 8) ??
    '—';
  const statusDotClass = getTicketStatusDotClass(statusLabel, ticket?.statusV2);

  const handleSaveTitle = (nextTitle: string): void => {
    if (!ticket?.id) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === title) return;
    void runTicketMutation(
      zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          title: trimmed,
          updatedAt: Date.now(),
        }),
      ),
      'Failed to update title',
    );
  };

  const handleSaveDescription = (nextDescription: string): void => {
    if (!ticket?.id) return;
    const trimmed = nextDescription.trim();
    if (!trimmed || trimmed === description) return;
    void runTicketMutation(
      zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          description: trimmed,
          updatedAt: Date.now(),
        }),
      ),
      'Failed to update description',
    );
  };

  const handleParentTicketPress = useCallback((): void => {
    setActiveTab('overview');
  }, []);

  const ticketShareLink = useMemo(() => {
    const workspaceId = normalizeWorkspaceIdForLink(getActiveWorkspaceId());
    return buildWebTicketLinkFromIds({
      channelId,
      conversationId,
      ticketId: effectiveTicketId,
      selectedTab: activeTab,
      ...(workspaceId ? { workspaceId } : {}),
    });
  }, [activeTab, channelId, conversationId, effectiveTicketId]);

  const handleCopyTicketLink = useCallback((): void => {
    if (!ticketShareLink) {
      showMessageToast('This ticket does not have a link yet.', 'warning');
      return;
    }
    void Clipboard.setStringAsync(ticketShareLink)
      .then(() => showMessageToast('Link copied', 'success'))
      .catch(() => showMessageToast('Unable to copy link', 'error'));
  }, [ticketShareLink]);

  const threadUnreadCount = useMemo(
    () =>
      countThreadUnreadActivities(unreadActivities, {
        ticketId: effectiveTicketId,
        conversationId,
      }),
    [unreadActivities, effectiveTicketId, conversationId],
  );

  const tabs = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview', count: null },
      { id: 'thread' as const, label: 'Thread', count: threadUnreadCount },
    ],
    [threadUnreadCount],
  );

  const metaRows = buildOverviewMetaRows({
    ticketMetaIconColor,
    destructiveColor,
    assigneeDisplayName,
    assigneeUserId,
    isAssigneeUpdating: editors.isAssigneeUpdating,
    userGroupDisplayName,
    ticketUserGroupId,
    isUserGroupUpdating: editors.isUserGroupUpdating,
    createdAtLabel,
    boardName,
    labels,
    statusLabel,
    createdByUserId: ticket?.createdBy,
    reporterName: reporter?.name ?? 'Unknown',
    priorityLabel,
    selectedTicketType,
    channelName,
    dueDateLabel,
    dueDateTextColor,
    isDueDateOverdue,
    etaManagementView,
    showStatusDeadline,
    statusDeadlineLabel,
    isStatusDeadlineOverdue,
    onOpenAssignee: editors.handleOpenAssigneePicker,
    onOpenUserGroup: editors.handleOpenUserGroupPicker,
    onOpenBoard: editors.handleOpenBoardPicker,
    onOpenLabels: editors.handleOpenLabelsPicker,
    onOpenStatus: editors.handleOpenStatusPicker,
    onOpenPriority: editors.handleOpenPriorityPicker,
    onOpenType: editors.handleOpenTypePicker,
    onOpenDueDate: editors.handleOpenDueDatePicker,
    onOpenStatusDeadline: editors.handleOpenStatusDeadlinePicker,
    onAcknowledgeEtaRisk: editors.handleAcknowledgeEtaRisk,
  });

  return (
    <View className='flex-1 bg-primary-bg'>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View className='flex-row items-center gap-2 px-3 h-14'>
          <HeaderBackButton
            liquidGlass
            iconColor={foregroundColor}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/');
              }
            }}
          />
          <Text className='flex-1 text-foreground text-[17px] font-semibold'>Ticket Details</Text>
          <HeaderIconButton
            liquidGlass
            accessibilityLabel='Copy ticket link'
            disabled={!ticketShareLink}
            onPress={handleCopyTicketLink}
          >
            <Copy size={20} color={foregroundColor} />
          </HeaderIconButton>
        </View>

        <View className='border-b border-ticket-header-accessory'>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ height: 44, paddingHorizontal: 12 }}
          >
            {tabs.map(tab => (
              <Pressable
                key={tab.id}
                onPress={() => {
                  if (activeTab !== tab.id) void haptics.selection();
                  setActiveTab(tab.id);
                }}
                className={cn(
                  'items-center justify-center border-b-2 px-4',
                  activeTab === tab.id ? 'border-tab-active-text' : 'border-transparent',
                )}
              >
                <View className='flex-row items-center gap-1'>
                  <Text
                    className={cn(
                      'text-sm',
                      activeTab === tab.id
                        ? 'text-foreground font-semibold'
                        : 'text-secondary-foreground font-medium',
                    )}
                  >
                    {tab.label}
                  </Text>
                  {tab.count !== null && tab.count > 0 ? (
                    <UnreadCountBadge count={tab.count} size='sm' />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <TicketTabPager
          activeTab={activeTab}
          onTabChange={setActiveTab}
          overview={
            <OverviewTab
              boardName={boardName}
              ticketShortId={ticketShortId}
              title={title}
              statusDotClass={statusDotClass}
              statusLabel={statusLabel}
              assigneeName={assigneeDisplayName}
              assigneeId={assigneeUserId ?? ''}
              dueDateShort={dueDateShort}
              description={description}
              metaRows={metaRows}
              onSaveTitle={handleSaveTitle}
              onSaveDescription={handleSaveDescription}
            />
          }
          thread={
            useV3 ? (
              <TicketThreadPane
                channelId={channelId}
                threadId={conversationId}
                ticketId={effectiveTicketId}
                parentTicketMd={fallbackConversation?.ticket_md ?? null}
                parentTicketId={effectiveTicketId}
                onParentTicketPress={handleParentTicketPress}
                {...(targetMessageId ? { messageId: targetMessageId } : {})}
                {...(from ? { from } : {})}
                {...(source ? { source } : {})}
                {...(createdAt ? { createdAt } : {})}
              />
            ) : (
              <ChatThread
                channelId={channelId}
                threadId={conversationId}
                composerInsetMode='screen'
                parentTicketMd={fallbackConversation?.ticket_md ?? null}
                parentTicketId={effectiveTicketId}
                onParentTicketPress={handleParentTicketPress}
                {...(targetMessageId ? { messageId: targetMessageId } : {})}
                {...(from ? { from } : {})}
                {...(openStartedAtMs !== undefined ? { openStartedAtMs } : {})}
                {...(chatOpenAttemptId ? { chatOpenAttemptId } : {})}
                hideHeader
              />
            )
          }
        />
      </SafeAreaView>

      <TicketDetailsPickers
        editors={editors}
        channelId={channelId}
        assigneePickerGroupId={assigneePickerGroupId}
        ticketUserGroupId={ticketUserGroupId}
        userGroupOptions={userGroupOptions}
        ticketMetaIconColor={ticketMetaIconColor}
        assigneeUserId={assigneeUserId}
        isUnassigned={assigneeRef === null}
        selectedPriority={selectedPriority}
        boardOptions={boardOptions}
        selectedBoardId={selectedBoardId}
        projectId={projectId}
        isBoardsLoading={isBoardsLoading}
        statusOptions={statusOptions}
        selectedStageName={selectedStageName}
        typeOptions={typeOptions}
        selectedTicketType={selectedTicketType}
        labelOptions={labelOptions}
        selectedLabelValues={selectedLabelValues}
        etaMs={etaMs}
        dueDateMin={dueDateMin}
        statusDeadlineMs={statusDeadlineMs}
        statusDeadlineMin={statusDeadlineMin}
        isStatusDeadlinePickerEnabled={showStatusDeadline}
      />
    </View>
  );
}
