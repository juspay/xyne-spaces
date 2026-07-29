import { ReactElement, useMemo } from 'react';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  buildStageVisitFormValues,
  matchFormVisit,
  FormSubmissionBlock,
  type FormValueEntry,
} from '../../Tickets/TicketActivity/formSubmission';

interface StageMoveFormBlockProps {
  conversationId: string;
  toStageName: string;
  timestamp: number | string | Date;
}

/**
 * Renders the same "Form submission · N fields" block the Details activity timeline shows, but for
 * a stage-move SYSTEM message in the conversation thread. The message itself carries no form data,
 * so we resolve the ticket from the conversation, load its form values + board stages, and match
 * the submission to this move using the SAME builder/matcher the Details page uses — so the two
 * surfaces stay in sync by construction.
 *
 * Zero dedupes these queries by args, so every stage-move message in one thread shares a single
 * subscription per (conversation, ticket, board) — it is not a per-message fetch.
 */
export const StageMoveFormBlock = ({
  conversationId,
  toStageName,
  timestamp,
}: StageMoveFormBlockProps): ReactElement | null => {
  const [conversation] = useCachedQuery(queries.getConversationById({ conversationId }), {
    enabled: !!conversationId,
  });
  const ticket = (conversation as { ticket?: { id?: string; boardId?: string } | null } | undefined)
    ?.ticket;
  const ticketId = ticket?.id ?? '';
  const boardId = ticket?.boardId ?? '';

  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticketId }),
    { enabled: !!ticketId },
  );
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId }), { enabled: !!boardId });

  const matched = useMemo(() => {
    const stageVisits = buildStageVisitFormValues(
      formEntityValues as FormValueEntry[] | undefined,
      stages as ReadonlyArray<{ id: string; name: string }> | undefined,
    );
    return matchFormVisit(stageVisits, toStageName, timestamp);
  }, [formEntityValues, stages, toStageName, timestamp]);

  if (!matched) return null;
  return <FormSubmissionBlock formValues={matched.formValues} version={matched.version} />;
};
