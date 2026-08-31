import { ReactElement, useRef } from 'react';
import useMeasure from '../../../hooks/useMeasure';
import { ResizableGroup, Panel, Separator } from '../../ui/Resizable/Resizable';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { TicketDetails } from '../TicketDetails/TicketDetails';
import ThreadMessages from '../../Chat/ThreadPannel';
import { ChevronLeft, MultipleCrossCancelDefault as X } from '@xyne/icons';

const TicketView = (): ReactElement => {
  const ticketViewContainerRef = useRef<HTMLDivElement>(null);
  const { projectId, boardId, ticketId } = useParams<{
    projectId?: string;
    boardId?: string;
    ticketId: string;
  }>();

  const navigate = useNavigate();

  // Query ticket data to get xyneId and channelId
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  const bounds = useMeasure({ ref: ticketViewContainerRef, observeResize: true });
  const shouldStack = bounds.width < 700;

  const defaultTicketDetailSize = 100 - 47;
  const minTicketDetailSize = 30;

  if (!ticketId) {
    return (
      <div className='flex items-center justify-center h-full text-muted-foreground'>
        <p className='text-sm'>No ticket selected</p>
      </div>
    );
  }

  return (
    <div
      ref={ticketViewContainerRef}
      data-component='TicketView'
      className='h-full bg-background flex flex-col'
    >
      {/* Header with Ticket Sequence ID */}
      {ticket && (
        <div className='flex justify-between items-center px-6 py-3 border-b border-border bg-background flex-shrink-0'>
          <div className='flex items-center gap-2'>
            <ChevronLeft
              size={16}
              className='cursor-pointer'
              onClick={() => {
                if (projectId && boardId) {
                  void navigate(`/projects/${projectId}/${boardId}`);
                } else {
                  void navigate(-1);
                }
              }}
              data-track-category='Tickets'
              data-track-name='NavigateBackFromTicket'
            />
            <span className='text-[14px] text-foreground font-mono'>{ticket.xyneId}</span>
          </div>
          <Link
            to={
              ticket.channelId
                ? `/chat/dir/${ticket.channelId}?tab=tickets&layout=table`
                : `/projects/${projectId}/${boardId}`
            }
            className='p-1 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors duration-200'
            aria-label='Close thread panel'
          >
            <X size={20} />
          </Link>
        </div>
      )}

      {/* Main Content */}
      <div className='flex-1 min-h-0'>
        {shouldStack ? (
          <>
            <TicketDetails ticketId={ticketId} />
            <div className='absolute inset-0 bg-background z-10 rounded-lg'>
              <ThreadMessages />
            </div>
          </>
        ) : (
          <ResizableGroup orientation='horizontal' className='h-full' autoSaveId={ticketId}>
            <Panel
              id='ticket-detail'
              defaultSize={`${defaultTicketDetailSize}%`}
              minSize={`${minTicketDetailSize}%`}
            >
              <TicketDetails ticketId={ticketId} />
            </Panel>

            <Separator className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div id='panel-resize-divider' className='w-[1px] h-full bg-border'></div>
            </Separator>

            <Panel id='ticket-thread' defaultSize='47%' minSize='40%'>
              <div className='h-full'>
                <ThreadMessages showHeader={true} />
              </div>
            </Panel>
          </ResizableGroup>
        )}
      </div>
    </div>
  );
};

export default TicketView;
