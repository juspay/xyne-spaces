import { ReactElement, useMemo } from 'react';
import { useZero } from '../../../hooks/useZero';
import { CreateTicketModal } from '../CreateTicketModal/CreateTicketModal';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { toast } from 'sonner';

interface SubTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  conversationId: string;
  sourceMessageId?: string;
  onSuccess?: () => void;
}

type InitialAssignee = { type: 'assigneeTo' | 'userGroup'; value: string } | null;

export const SubTicketModal = ({
  isOpen,
  onClose,
  ticketId,
  conversationId,
  sourceMessageId,
  onSuccess,
}: SubTicketModalProps): ReactElement | null => {
  const zero = useZero();

  // Get ticket info to pass to CreateTicketModal
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId }));

  // A sub-ticket inherits the parent's assignee, falling back to its user group.
  const initialAssignee = useMemo<InitialAssignee>(() => {
    if (ticket?.assignedTo) return { type: 'assigneeTo', value: ticket.assignedTo };
    if (ticket?.userGroupId) return { type: 'userGroup', value: ticket.userGroupId };
    return null;
  }, [ticket?.assignedTo, ticket?.userGroupId]);

  // Zero stores eta as epoch ms; CreateTicketModal expects a Date.
  const initialEta = useMemo(() => (ticket?.eta ? new Date(ticket.eta) : null), [ticket?.eta]);

  const initialTags = useMemo(
    () => ticket?.tagMappings?.map(tag => tag.tagName).filter(Boolean) ?? [],
    [ticket?.tagMappings],
  );

  // CreateTicketModal reads its initial values once on mount, so hold off until
  // the parent ticket has loaded — otherwise the prefill silently comes up empty.
  if (!isOpen || !ticket) return null;

  return (
    <CreateTicketModal
      isOpen={isOpen}
      onClose={onClose}
      channelId={ticket.conversation?.channelId || ''}
      projectId={ticket.projectId || ''}
      selectedBoardId={ticket.boardId}
      initialAssignee={initialAssignee}
      initialEta={initialEta}
      initialPriority={ticket.priority}
      initialTags={initialTags}
      isFromSubTicket={true}
      {...(sourceMessageId && { sourceMessageId })}
      parentTicketId={ticketId}
      onTicketCreated={createdTicket => {
        // Create SubTicket and mapping using Zero mutators
        const subTicketId = uuidv4();
        const mappingId = uuidv4();
        const timestamp = Date.now();

        void zero
          .mutate(
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
          )
          .server.then(result => {
            if (result.type === 'error') {
              toast.error(result.error.message || 'Failed to create sub-ticket');
            }
          })
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Failed to create sub-ticket');
          });

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
