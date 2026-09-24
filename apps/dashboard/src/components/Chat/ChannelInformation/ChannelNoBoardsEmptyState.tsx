import { ReactElement, useState } from 'react';
import { LayerTwo as Layers } from '@xyne/icons';
import Button from '../../ui/Button';
import { useChannel } from '../../../hooks/useChannels';
import { useCanLinkChannelBoards } from '../../../hooks/useCanLinkChannelBoards';
import { LinkBoardsDialog } from './LinkBoardsDialog';

interface ChannelNoBoardsEmptyStateProps {
  channelId: string;
}

/**
 * Shown wherever a channel's tickets would render but it has no boards linked.
 *
 * It carries its own way out: the kanban header's Link Boards button lives inside
 * the board view, which such a channel never reaches, so without this a boardless
 * channel could never be given a board. Rendered both by the Tickets tab and by
 * KanbanBoardScreen itself, since other hosts (Streams surfaces, SDLC) mount the
 * screen with a channelId directly and bypass the tab.
 */
export const ChannelNoBoardsEmptyState = ({
  channelId,
}: ChannelNoBoardsEmptyStateProps): ReactElement => {
  const channel = useChannel(channelId);
  const canLinkBoards = useCanLinkChannelBoards(channelId);
  const [isLinkBoardsOpen, setIsLinkBoardsOpen] = useState(false);

  return (
    <div className='flex h-full flex-col items-center justify-center gap-1 p-8 text-center'>
      <p className='text-sm font-medium text-foreground'>
        No boards are configured for this channel
      </p>
      <p className='text-sm text-muted-foreground'>
        {canLinkBoards
          ? 'Link a board to this channel to start creating and tracking tickets.'
          : 'Ask a channel admin or a workspace admin to link one, to start creating and tracking tickets.'}
      </p>
      {canLinkBoards && (
        <>
          <Button
            size='sm'
            className='mt-3'
            onClick={() => setIsLinkBoardsOpen(true)}
            data-testid='channel-tickets-empty-link-boards-button'
            data-track-event='BUTTON_CLICK'
            data-track-category='Channel'
            data-track-name='OPEN_LINK_BOARDS'
            data-track-metadata={JSON.stringify({ channelId, source: 'tickets_empty_state' })}
          >
            <Layers className='w-3 h-3' />
            <span className='font-semibold'>Link Boards</span>
          </Button>
          {isLinkBoardsOpen && (
            <LinkBoardsDialog
              channelId={channelId}
              channelName={channel?.name}
              open={isLinkBoardsOpen}
              onOpenChange={setIsLinkBoardsOpen}
            />
          )}
        </>
      )}
    </div>
  );
};

export default ChannelNoBoardsEmptyState;
