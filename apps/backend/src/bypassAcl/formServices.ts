import type { Prisma, PrismaClient } from '@prisma/client';
import { rawQuery } from './base';

type FormClient = PrismaClient | Prisma.TransactionClient;

/**
 * Relocated from jiraMigrationPreviewService. Joins form_fields to its context mapping and
 * re-checks the board's workspace inline. SQL unchanged.
 */
export async function queryBoardTicketFormFields(client: FormClient, targetBoardId: string, contextType: string, entityType: string, workspaceId: string | null): Promise<Array<{ id: string; fieldName: string; fieldType: string; isOptional: boolean }>> {
  return rawQuery(
    ['FormFields', 'FormContextMapping', 'Board'],
    'jira migration preview: form fields for a board, workspace predicate written explicitly in the SQL',
    () => client.$queryRaw<Array<{ id: string; fieldName: string; fieldType: string; isOptional: boolean }>>`
        SELECT ff.id, ff."fieldName", ff."fieldType", ff."isOptional"
        FROM public.form_fields ff
        INNER JOIN public.forms_context_mapping fcm ON fcm."formId" = ff."formId"
        WHERE fcm."contextId" = ${targetBoardId}
          AND fcm."contextType" = ${contextType}
          AND fcm."entityType" = ${entityType}
          AND EXISTS (
            SELECT 1 FROM public.boards b
            WHERE b.id = fcm."contextId" AND b."workspaceId" = ${workspaceId}
          )
        ORDER BY ff."createdAt" ASC
      `,
  );
}
