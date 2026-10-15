import {
  BoardType,
  deriveEtaManagementView,
  LookupType,
  parseBoardEtaManagement,
  parseTicketEtaManagement,
} from '@xyne/shared';
import { format } from 'date-fns';
import { useMemo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { parseAssigneeRef } from '@/src/features/channel-tickets/utils/parse-assignee-ref';
import { useBoards } from '@/src/hooks/useBoards';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useChannelById, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useSelf, useUser } from '@/src/hooks/useUsers';
import { useUserGroups } from '@/src/hooks/useUserGroups';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import {
  formatUserGroupDisplayName,
  parseTicketPriority,
  resolveAssigneePickerGroupId,
  resolveTicketUserGroupId,
} from './assignment-utils';
import {
  formatETADisplay,
  getTicketStatusDotClass,
  isStageDeadlineOverdue,
  isTicketDueDateOverdue,
  normalizeTimestamp,
} from './helpers';
import { buildOverviewMetaRows } from './overview-meta-rows';
import {
  buildBoardOptions,
  buildLabelOptions,
  buildStageStatusOptions,
  buildTicketTypeOptions,
  buildUserGroupOptions,
} from './picker-options';
import { runTicketMutation } from './run-ticket-mutation';
import { OverviewTab } from './tabs/OverviewTab';
import { TicketDetailsPickers } from './ticket-details-pickers';
import { mapAppliedLabels } from './ticket-labels';
import { useTicketDetailsEditors } from './use-ticket-details-editors';

export type EditableTicketOverviewProps = {
  ticketId: string;
  /** Desk / screen channel — used when the ticket row has no channelId yet. */
  channelId?: string;
  /** Extra top inset for absolute headers (xyne-desk detail chrome). */
  contentPaddingTop?: number;
};

/**
 * Shared editable ticket overview — same fields/mutators as TicketDetailsScreen Overview.
 * Used by channel ticket details and xyne-desk Details tab.
 */
export function EditableTicketOverview({
  ticketId,
  channelId: channelIdProp,
  contentPaddingTop = 0,
}: EditableTicketOverviewProps): ReactElement {
  const zero = useZero();
  const ticketMetaIconColor = useCSSVariable('--color-ticket-meta-right-text') as string;
  const destructiveColor = (useCSSVariable('--color-destructive') as string) || '#FF4F4F';
  const dueDateTextColor =
    (useCSSVariable('--color-ticket-overview-due-text') as string) || '#c2410c';

  const [ticket, ticketDetails] = useCachedQuery(queries.ticketDetailsByIdV2({ ticketId }), {
    enabled: !!ticketId,
  });
  const isInitialLoading = ticketDetails.type !== 'complete' && !ticket;

  const self = useSelf();
  const reporter = useUser(ticket?.createdBy ?? '');

  const rawAssignedTo = ticket?.assignedTo ?? null;
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
    null,
  );
  const assigneePickerGroupId = resolveAssigneePickerGroupId(ticketUserGroupId, assigneeGroupId);
  const ticketUserGroupName = useMemo(() => {
    if (!ticketUserGroupId) return null;
    return userGroups.find(group => group.id === ticketUserGroupId)?.name ?? null;
  }, [ticketUserGroupId, userGroups]);
  const userGroupDisplayName = formatUserGroupDisplayName(ticketUserGroupName, ticketUserGroupId);
  const userGroupOptions = useMemo(() => buildUserGroupOptions(userGroups), [userGroups]);
  const projectName = (ticket as { project?: { name?: string } } | undefined)?.project?.name ?? '—';
  const projectId = ticket?.projectId ?? '';
  const selectedBoardId = ticket?.boardId ?? null;

  const [boardDetail] = useCachedQuery(
    queries.boardFullDetailById({ boardId: selectedBoardId ?? '' }),
    { enabled: !!selectedBoardId },
  );
  const { boards, isLoading: isBoardsLoading } = useBoards(projectId || undefined);
  const [boardStages] = useCachedQuery(queries.stagesByBoard({ boardId: selectedBoardId ?? '' }), {
    enabled: !!selectedBoardId,
  });

  const statusOptions = useMemo(() => buildStageStatusOptions(boardStages), [boardStages]);
  const selectedStageName = ticket?.stageName ?? null;
  const selectedTicketType = ticket?.ticketType ?? null;
  const selectedPriority = parseTicketPriority(ticket?.priority ?? null);
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

  const channelId = (ticket?.channelId?.trim() || channelIdProp?.trim() || '') as string;
  const channel = useChannelById(channelId);
  const channelDisplayName = useChannelDisplayName(channel, self?.id ?? '');
  const channelName = channel ? channelDisplayName : '—';

  const statusLabel = ticket?.stageName || ticket?.statusV2 || '—';
  const priorityLabel = ticket?.priority || '—';
  const etaMs = normalizeTimestamp(ticket?.eta ?? null);
  const dueDateShort = etaMs ? format(new Date(etaMs), 'MMM d') : '—';
  const dueDateLabel = etaMs ? formatETADisplay(etaMs) : 'Set Due Date';
  const ticketStatusV2 = ticket?.statusV2 ?? '';
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

  const createdAtMs = normalizeTimestamp(ticket?.createdAt ?? null);
  const createdAtLabel = createdAtMs ? format(new Date(createdAtMs), 'MMM d, yyyy') : '—';
  const title = ticket?.title ?? 'Untitled ticket';
  const description = ticket?.description?.trim() ? ticket.description : 'No description';
  const boardName =
    boardDetail?.name?.trim() ||
    boards.find(board => board.id === selectedBoardId)?.name?.trim() ||
    (ticket as { board?: { name?: string }; boardName?: string } | undefined)?.board?.name ||
    (ticket as { board?: { name?: string }; boardName?: string } | undefined)?.boardName ||
    projectName;
  const ticketShortId = ticket?.xyneId ?? ticketId.slice(0, 8);
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

  if (isInitialLoading) {
    return (
      <View
        style={{ paddingTop: contentPaddingTop }}
        className='flex-1 items-center justify-center px-6'
      >
        <Text className='text-[15px] text-secondary-foreground'>Loading details…</Text>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View
        style={{ paddingTop: contentPaddingTop }}
        className='flex-1 items-center justify-center px-6'
      >
        <Text className='text-[15px] text-secondary-foreground'>Ticket not found</Text>
      </View>
    );
  }

  return (
    <View className='flex-1'>
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
        contentPaddingTop={contentPaddingTop}
      />

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
