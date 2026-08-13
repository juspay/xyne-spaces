import { useEffect } from 'react';
import {
  documentTitleActor,
  type DocumentTitleContribution,
} from '../machines/documentTitleMachine';

export const useDocumentTitleContribution = (
  contribution: DocumentTitleContribution | null | undefined,
): void => {
  const id = contribution?.id;
  const priority = contribution?.priority;
  const scope = contribution?.scope;
  const entityType = contribution?.entity.type;
  const entityLabel = contribution?.entity.label;

  useEffect(() => {
    if (!id || priority === undefined || !entityType || entityLabel === undefined) return;

    documentTitleActor.send({
      type: 'UPSERT_CONTRIBUTION',
      contribution: {
        id,
        priority,
        ...(scope && { scope }),
        entity: {
          type: entityType,
          label: entityLabel,
        },
      },
    });

    return (): void => {
      documentTitleActor.send({ type: 'REMOVE_CONTRIBUTION', id });
    };
  }, [id, priority, scope, entityType, entityLabel]);
};
