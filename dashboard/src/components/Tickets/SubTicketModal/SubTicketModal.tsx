import { ReactElement } from 'react';
import { useZero } from '@rocicorp/zero/react';
import { CreateTicketModal } from '../CreateTicketModal/CreateTicketModal';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface SubTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  conversationId: string;
  onSuccess?: () => void;
}

export const SubTicketModal = ({
  isOpen,
  onClose,
  ticketId,
  conversationId,
  onSuccess,
}: SubTicketModalProps): ReactElement | null => {
  const zero = useZero();

  // Get ticket info to pass to CreateTicketModal
  const [ticket] = useCachedQuery(queries.ticketById({ ticketId }));

  if (!isOpen) return null;

  return (
    <CreateTicketModal
      isOpen={isOpen}
      onClose={onClose}
      channelId={ticket?.conversation?.channelId || ''}
      projectId={ticket?.projectId || ''}
      isFromSubTicket={true}
      onTicketCreated={createdTicket => {
        // Create SubTicket and mapping using Zero mutators
        const subTicketId = uuidv4();
        const mappingId = uuidv4();
        const timestamp = Date.now();

        void zero.mutate(
          mutators.subTicket.create({
            title: createdTicket.xyneId || 'Subticket',
            description: undefined,
            ticketId: ticketId,
            conversationId: conversationId,
            subTicketId,
            mappingId,
            timestamp,
            subTicketXyneId: createdTicket.xyneId,
          }),
        );

        // Update subticket with mappedTicketId
        void zero.mutate(
          mutators.subTicket.update({
            subTicketId,
            mappedTicketId: createdTicket.id,
            conversationId: createdTicket.conversationId,
            timestamp,
          }),
        );

        onClose();
        onSuccess?.();
      }}
    />
  );
};
