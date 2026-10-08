import { Circle } from '@xyne/icons';
import { TicketStatusV2 } from '@xyne/shared';
import { StatusOptions } from '../TicketTable/TicketTableHelper';

export const KanbanIcon = ({ status }: { status?: TicketStatusV2 | undefined }) => {
  if (!status) {
    return <Circle className='w-4 h-4 text-muted-foreground' />;
  }
  const statusOption = StatusOptions.find(opt => (opt.value as TicketStatusV2) === status);
  if (statusOption) {
    return <>{statusOption.icon}</>;
  }
  return <Circle className='w-4 h-4 text-muted-foreground' />;
};
