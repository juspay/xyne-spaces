import React from 'react';
import BoardKanbanScreen from '../KanbanBoardScreen/KanbanBoardScreen';

const FilteredTicketsScreen: React.FC = () => {
  return <BoardKanbanScreen viewMode='my-tickets' />;
};

FilteredTicketsScreen.displayName = 'FilteredTicketsScreen';

export default FilteredTicketsScreen;
