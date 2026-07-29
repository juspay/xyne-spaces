import React from 'react';
import BoardKanbanScreen from '../KanbanBoardScreen/KanbanBoardScreen';
import { useSearchParams } from 'react-router-dom';

const FilteredTicketsScreen: React.FC = () => {
  const [searchParams] = useSearchParams();
  const assigneeId = searchParams.get('assignee') || undefined;
  const groupId = searchParams.get('group') || undefined;

  // Priority: group filter first, then assignee filter, then my-tickets
  if (groupId) {
    return <BoardKanbanScreen viewMode='group-tickets' filterByGroupId={groupId} />;
  }
  if (assigneeId) {
    return <BoardKanbanScreen viewMode='user-tickets' filterByUserId={assigneeId} />;
  }
  return <BoardKanbanScreen viewMode='my-tickets' />;
};

FilteredTicketsScreen.displayName = 'FilteredTicketsScreen';

export default FilteredTicketsScreen;
