import type { TicketPriority } from '@xyne/shared';
import type { ReactElement } from 'react';
import { Users } from 'lucide-react-native';

import { TICKET_PRIORITY_FILTER_OPTIONS } from '@/src/features/xyne-desks/tickets/constants';
import { TicketsPriorityIcon } from '@/src/features/xyne-desks/tickets/components/tickets-priority-filter';

import { DatePickerSheet } from './date-picker-sheet';
import { MultiSelectPickerSheet } from './multi-select-picker-sheet';
import type { PickerOption } from './picker-options';
import { SingleSelectPickerSheet } from './single-select-picker-sheet';
import type { TicketDetailsEditors } from './use-ticket-details-editors';
import { UserPickerSheet } from './user-picker-sheet';

type TicketDetailsPickersProps = {
  editors: TicketDetailsEditors;
  channelId: string;
  /** Scopes assignee candidates (ticket group, else assignee-as-group). */
  assigneePickerGroupId: string | null | undefined;
  ticketUserGroupId: string | null;
  userGroupOptions: PickerOption[];
  ticketMetaIconColor: string;
  assigneeUserId: string | null;
  isUnassigned: boolean;
  selectedPriority: TicketPriority | null;
  boardOptions: PickerOption[];
  selectedBoardId: string | null;
  projectId: string;
  isBoardsLoading: boolean;
  statusOptions: PickerOption[];
  selectedStageName: string | null;
  typeOptions: PickerOption[];
  selectedTicketType: string | null;
  labelOptions: PickerOption[];
  selectedLabelValues: string[];
  etaMs: number | null;
  dueDateMin: Date;
  statusDeadlineMs: number | null;
  statusDeadlineMin: Date;
  isStatusDeadlinePickerEnabled: boolean;
};

export function TicketDetailsPickers({
  editors,
  channelId,
  assigneePickerGroupId,
  ticketUserGroupId,
  userGroupOptions,
  ticketMetaIconColor,
  assigneeUserId,
  isUnassigned,
  selectedPriority,
  boardOptions,
  selectedBoardId,
  projectId,
  isBoardsLoading,
  statusOptions,
  selectedStageName,
  typeOptions,
  selectedTicketType,
  labelOptions,
  selectedLabelValues,
  etaMs,
  dueDateMin,
  statusDeadlineMs,
  statusDeadlineMin,
}: TicketDetailsPickersProps): ReactElement {
  return (
    <>
      <UserPickerSheet
        isOpen={editors.isAssigneePickerOpen}
        channelId={channelId}
        userGroupId={assigneePickerGroupId ?? null}
        selectedUserId={assigneeUserId}
        isUnassigned={isUnassigned}
        onClose={editors.closeAssigneePicker}
        onSelect={editors.handleSelectAssignee}
      />
      <SingleSelectPickerSheet
        isOpen={editors.isUserGroupPickerOpen}
        title='User Group'
        options={userGroupOptions}
        selectedValue={ticketUserGroupId}
        onClose={editors.closeUserGroupPicker}
        onSelect={editors.handleSelectUserGroup}
        searchable
        searchPlaceholder='Search groups...'
        emptyLabel='No groups found'
        renderLeading={() => <Users size={18} color={ticketMetaIconColor} />}
      />
      <SingleSelectPickerSheet
        isOpen={editors.isPriorityPickerOpen}
        title='Priority'
        options={TICKET_PRIORITY_FILTER_OPTIONS}
        selectedValue={selectedPriority}
        onClose={editors.closePriorityPicker}
        onSelect={editors.handleSelectPriority}
        renderLeading={option => <TicketsPriorityIcon priority={option.value} size={16} />}
      />
      <SingleSelectPickerSheet
        isOpen={editors.isBoardPickerOpen}
        title='Board'
        options={boardOptions}
        selectedValue={selectedBoardId}
        onClose={editors.closeBoardPicker}
        onSelect={editors.handleSelectBoard}
        searchable
        searchPlaceholder='Search boards'
        emptyLabel={
          !projectId
            ? 'No project linked to this ticket'
            : isBoardsLoading
              ? 'Loading boards…'
              : 'No boards found'
        }
        maxVisibleOptions={10}
      />
      <SingleSelectPickerSheet
        isOpen={editors.isStatusPickerOpen}
        title='Status'
        options={statusOptions}
        selectedValue={selectedStageName}
        onClose={editors.closeStatusPicker}
        onSelect={editors.handleSelectStatus}
        emptyLabel={selectedBoardId ? 'No statuses found' : 'No board linked to this ticket'}
      />
      <SingleSelectPickerSheet
        isOpen={editors.isTypePickerOpen}
        title='Type'
        options={typeOptions}
        selectedValue={selectedTicketType}
        onClose={editors.closeTypePicker}
        onSelect={editors.handleSelectType}
        emptyLabel='No types found'
      />
      <MultiSelectPickerSheet
        isOpen={editors.isLabelsPickerOpen}
        title='Labels'
        options={labelOptions}
        selectedValues={selectedLabelValues}
        onClose={editors.closeLabelsPicker}
        onConfirm={editors.handleConfirmLabels}
        searchable
        searchPlaceholder='Search or create label'
        emptyLabel={
          projectId ? 'No labels yet — type to create one' : 'No project linked to this ticket'
        }
        allowCreate
      />
      <DatePickerSheet
        isOpen={editors.isDueDatePickerOpen}
        title='Due Date'
        value={etaMs}
        mode='datetime'
        allowClear={false}
        minimumDate={dueDateMin}
        onClose={editors.closeDueDatePicker}
        onSelect={editors.handleSelectDueDate}
      />
      <DatePickerSheet
        isOpen={editors.isStatusDeadlinePickerOpen}
        title='Status Deadline'
        value={statusDeadlineMs}
        mode='datetime'
        allowClear={false}
        minimumDate={statusDeadlineMin}
        onClose={editors.closeStatusDeadlinePicker}
        onSelect={editors.handleSelectStatusDeadline}
      />
    </>
  );
}
