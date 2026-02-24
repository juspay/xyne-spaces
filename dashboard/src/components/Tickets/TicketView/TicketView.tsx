import { ReactElement, useRef } from 'react';
import useMeasure from '../../../hooks/useMeasure';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { TicketDetails } from '../TicketDetails/TicketDetails';
import ThreadMessages from '../../Chat/ThreadPannel';
import { ChevronLeft, X } from 'lucide-react';

const TicketView = (): ReactElement => {
  const ticketViewContainerRef = useRef<HTMLDivElement>(null);
  const { projectId, boardId, ticketId } = useParams<{
    projectId?: string;
    boardId?: string;
    ticketId: string;
  }>();

  const navigate = useNavigate();

  // Query ticket data to get xyneId and channelId
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  const bounds = useMeasure({ ref: ticketViewContainerRef, observeResize: true });
  const shouldStack = bounds.width < 700;

  const defaultTicketDetailSize = 100 - 47;
  const minTicketDetailSize = 30;

  if (!ticketId) {
    return (
      <div className='flex items-center justify-center h-full text-gray-500'>
        <p className='text-sm'>No ticket selected</p>
      </div>
    );
  }

  return (
    <div
      ref={ticketViewContainerRef}
      data-component='TicketView'
      className='h-full bg-white flex flex-col'
    >
      {/* Header with Ticket Sequence ID */}
      {ticket && (
        <div className='flex justify-between items-center px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0'>
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
            <span className='text-[14px] texxt-[#202020] font-mono'>{ticket.xyneId}</span>
          </div>
          <Link
            to={
              ticket.channelId
                ? `/chat/dir/${ticket.channelId}?tab=tickets&layout=table`
                : `/projects/${projectId}/${boardId}`
            }
            className='p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
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
            <div className='absolute inset-0 bg-white z-10 rounded-lg'>
              <ThreadMessages />
            </div>
          </>
        ) : (
          <PanelGroup direction='horizontal' className='h-full' autoSaveId={ticketId}>
            <Panel defaultSize={defaultTicketDetailSize} minSize={minTicketDetailSize}>
              <TicketDetails ticketId={ticketId} />
            </Panel>

            <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
              <div id='panel-resize-divider' className='w-[1px] h-full bg-gray-200'></div>
            </PanelResizeHandle>

            <Panel defaultSize={47} minSize={40}>
              <div className='h-full'>
                <ThreadMessages showHeader={true} />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
};

export default TicketView;
