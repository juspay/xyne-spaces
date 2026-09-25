import { ReactElement } from 'react';
import { Panel, ResizableGroup, Separator } from '../../ui/Resizable/Resizable';
import { TicketDetails } from '../TicketDetails/TicketDetails';
import { ThreadMessages } from '../../Chat/ThreadPannel';

export const ExpandedTicketView = ({
  ticketId,
  channelId,
  conversationId,
  onMinimize,
}: {
  ticketId: string;
  channelId: string;
  conversationId: string;
  onMinimize?: () => void;
}): ReactElement => {
  return (
    <ResizableGroup orientation='horizontal'>
      <Panel minSize='60%'>
        <TicketDetails
          ticketId={ticketId}
          expandedView={true}
          {...(onMinimize ? { onMinimize } : {})}
        />
      </Panel>
      <Separator className='w-1 hover:bg-sidebar-divider active:bg-sidebar-divider transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
        <div id='panel-resize-divider' className='w-[1px] h-full bg-border'></div>
      </Separator>
      <Panel minSize='40%'>
        <ThreadMessages
          channelId={channelId}
          conversationId={conversationId}
          underTicketView={true}
        />
      </Panel>
    </ResizableGroup>
  );
};
