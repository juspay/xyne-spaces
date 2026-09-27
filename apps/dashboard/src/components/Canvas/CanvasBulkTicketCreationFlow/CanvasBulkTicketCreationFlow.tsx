import type { ReactElement } from 'react';
import { BulkTicketMode } from '@xyne/shared';

import { useChannel } from '../../../hooks/useChannels';
import { BulkCreateTicketsModal } from '../../Tickets/BulkCreateTicketsModal/BulkCreateTicketsModal';
import type { CanvasTableTicketDraft } from '../useCanvasTableFilters';

interface CanvasBulkTicketCreationFlowProps {
  draft: CanvasTableTicketDraft | null;
  channelId?: string | undefined;
  onClose: () => void;
}

/**
 * Bulk ticket creation from a canvas table, shaped like the chat composer's:
 * the first row becomes the parent ticket and every row under it a sub-ticket.
 */
export function CanvasBulkTicketCreationFlow({
  draft,
  channelId,
  onClose,
}: CanvasBulkTicketCreationFlowProps): ReactElement | null {
  const effectiveChannelId = channelId ?? '';
  const effectiveChannel = useChannel(effectiveChannelId);

  if (!draft) return null;

  return (
    <BulkCreateTicketsModal
      isOpen={true}
      onClose={onClose}
      channelId={effectiveChannelId}
      {...(effectiveChannel?.projectId ? { projectId: effectiveChannel.projectId } : {})}
      mode={BulkTicketMode.PARENT_SUB}
      parentTitle={draft.titles[0] ?? ''}
      subTitleTitles={draft.titles.slice(1)}
      subDescriptions={draft.descriptions}
    />
  );
}
