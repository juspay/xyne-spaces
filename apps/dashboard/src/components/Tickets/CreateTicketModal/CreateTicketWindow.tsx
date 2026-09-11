import React, { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TicketPriority } from '@xyne/shared';
import { CreateTicketModal } from './CreateTicketModal';
import {
  consumeCreateTicketDraft,
  postCreateTicketResult,
  type CreateTicketPopoutDraft,
  type PopOutTicketResult,
} from '../../../utils/electronApp';
import type { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';

export const CreateTicketWindow: React.FC = () => {
  const [searchParams] = useSearchParams();
  const popoutId = searchParams.get('popoutId') ?? '';

  const draftRef = useRef<CreateTicketPopoutDraft | null | undefined>(undefined);
  if (draftRef.current === undefined) {
    draftRef.current = consumeCreateTicketDraft(popoutId);
  }
  const draft = draftRef.current;

  const handleClose = useCallback((): void => {
    window.setTimeout(() => window.close(), 400);
  }, []);

  const handleTicketCreated = useCallback(
    (ticket: PopOutTicketResult): void => {
      postCreateTicketResult(popoutId, ticket);
    },
    [popoutId],
  );

  if (!draft || !draft.channelId || !draft.projectId) {
    return (
      <div className='flex h-screen w-full items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground'>
        Missing ticket context. Please reopen Create Ticket from the app.
      </div>
    );
  }

  const f = draft.form ?? {};
  const sourceConversation: ConversationWithTicket | undefined = draft.sourceConversationId
    ? ({
        conversationId: draft.sourceConversationId,
        ...(draft.initialMessageId ? { initialMessageId: draft.initialMessageId } : {}),
      } as ConversationWithTicket)
    : undefined;

  return (
    <CreateTicketModal
      standalone={true}
      isOpen={true}
      onClose={handleClose}
      onTicketCreated={handleTicketCreated}
      channelId={draft.channelId}
      projectId={draft.projectId}
      selectedBoardId={f.boardId ?? null}
      initialTitle={f.title ?? ''}
      initialDescription={f.description ?? ''}
      initialPriority={(f.priority as TicketPriority | null) ?? null}
      isFromSubTicket={!!draft.isFromSubTicket}
      isFromAI={!!draft.isFromAI}
      {...(draft.sourceMessageId ? { sourceMessageId: draft.sourceMessageId } : {})}
      {...(draft.entityLinkContext ? { entityLinkContext: draft.entityLinkContext } : {})}
      standaloneSeed={{
        ...(f.workflowType ? { workflowType: f.workflowType } : {}),
        ...(draft.excludedChatAttachmentIds
          ? { excludedChatAttachmentIds: draft.excludedChatAttachmentIds }
          : {}),
      }}
      {...(f.tags ? { initialTags: f.tags } : {})}
      {...(f.assignee
        ? { initialAssignee: f.assignee as { type: 'assigneeTo' | 'userGroup'; value: string } }
        : {})}
      {...(draft.subTickets ? { initialSubTickets: draft.subTickets } : {})}
      {...(f.eta ? { initialEta: new Date(f.eta) } : {})}
      {...(sourceConversation ? { sourceConversation } : {})}
      {...(draft.parentTicketId ? { parentTicketId: draft.parentTicketId } : {})}
    />
  );
};

export default CreateTicketWindow;
