import { useMemo } from 'react';
import {
  FormContextType,
  FormEntityType,
  FormFieldType,
  extractFormFieldUserIds,
} from '@xyne/shared';
import { useAuth } from './useAuth';
import { useQuery } from './useQuery';
import { queries } from '../zero/queries';

export const useIsTicketStakeholder = (
  ticketId: string | null | undefined,
  enabled: boolean,
): { isStakeholder: boolean; isResolving: boolean } => {
  const { user } = useAuth();
  const userId = user?.id;
  const isEnabled = enabled && !!ticketId && !!userId;

  const [ticket, ticketDetails] = useQuery(queries.ticketRowById({ ticketId: ticketId ?? '' }), {
    enabled: isEnabled,
  });
  const [assignments, assignmentsDetails] = useQuery(
    queries.ticketAssignmentsByTicketId({ ticketId: ticketId ?? '' }),
    { enabled: isEnabled },
  );
  const [formValues, formValuesDetails] = useQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticketId ?? '' }),
    { enabled: isEnabled },
  );
  const boardId = ticket?.boardId;
  const [formMapping, formMappingDetails] = useQuery(
    queries.getFormMappingByContextId({
      contextId: boardId ?? '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: isEnabled && !!boardId },
  );

  const isStakeholder = useMemo(() => {
    if (!isEnabled || !ticket || !userId) return false;
    if (ticket.createdBy === userId || ticket.assignedTo === userId) return true;
    if (assignments.some(assignment => assignment.userId === userId)) return true;
    if (!formMapping) return false;
    return formValues.some(
      value =>
        value.entityType === 'TICKET' &&
        value.formField?.fieldType === FormFieldType.USER &&
        value.formField.formId === formMapping.formId &&
        extractFormFieldUserIds(value.actualFieldValue, value.fieldValue).includes(userId),
    );
  }, [isEnabled, ticket, assignments, formValues, formMapping, userId]);

  const isResolving =
    isEnabled &&
    (ticketDetails.type !== 'complete' ||
      assignmentsDetails.type !== 'complete' ||
      formValuesDetails.type !== 'complete' ||
      (!!boardId && formMappingDetails.type !== 'complete'));

  return { isStakeholder, isResolving };
};
