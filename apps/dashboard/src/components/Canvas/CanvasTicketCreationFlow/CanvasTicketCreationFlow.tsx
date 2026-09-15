import type { ReactElement } from 'react';

import { useChannel } from '../../../hooks/useChannels';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import type { CanvasTicketAnchor } from '../useCanvasTicketEditorBridge';

interface CreatedTicket {
  id: string;
  conversationId?: string;
  xyneId?: string;
  workflowType?: string;
}

interface CanvasTicketCreationFlowProps {
  anchor: CanvasTicketAnchor | null;
  channelId?: string | undefined;
  onClose: () => void;
  onTicketCreated: (ticket: CreatedTicket) => void;
}

export function CanvasTicketCreationFlow({
  anchor,
  channelId,
  onClose,
  onTicketCreated,
}: CanvasTicketCreationFlowProps): ReactElement | null {
  const effectiveChannelId = channelId ?? '';
  const effectiveChannel = useChannel(effectiveChannelId);

  if (!anchor) return null;

  return (
    <CreateTicketModal
      isOpen={true}
      onClose={onClose}
      channelId={effectiveChannelId}
      {...(effectiveChannel?.projectId ? { projectId: effectiveChannel.projectId } : {})}
      allowChannelSelection={!channelId}
      useLocalAttachments={true}
      initialDescription={anchor.blockText}
      onTicketCreated={onTicketCreated}
    />
  );
}
