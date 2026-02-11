import { useEffect, useMemo, useState } from 'react';
import { useZero } from './useZero';
import type { TicketReferenceMapping } from '@xyne/shared';
import { TicketReferenceRelation } from '@xyne/shared';
import type { SelectorOption } from '../components/ui/EntitySelector/EntitySelector.types';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

type ReferenceOut = Pick<TicketReferenceMapping, 'id' | 'targetTicketId' | 'relationType'>;

interface UseTicketReferencesParams {
  ticketId?: string | undefined;
  projectTickets?: Array<{
    id: string;
    title?: string | null;
    xyneId?: string | null;
  }>;
  referencesOut?: ReferenceOut[];
}

interface ReferenceRelationOption {
  value: TicketReferenceRelation;
  label: string;
}

interface UseTicketReferencesResult {
  referenceError: string | null;
  isReferenceSaving: boolean;
  referenceTicketOptions: SelectorOption[];
  referenceRelationOptions: ReferenceRelationOption[];
  handleAddReference: (targetTicketId: string | null) => void;
  handleRemoveReference: (referenceId: string) => void;
  handleReferenceRelationChange: (
    referenceId: string,
    relationType: TicketReferenceRelation,
  ) => void;
}

export const formatReferenceLabel = (relationType: TicketReferenceRelation): string => {
  switch (relationType) {
    case TicketReferenceRelation.DUPLICATE_CONFIRMED:
      return 'Duplicate';
    case TicketReferenceRelation.DUPLICATE_POSSIBLE:
      return 'Possible duplicate';
    case TicketReferenceRelation.LINKED:
    default:
      return 'Linked';
  }
};

export const formatIncomingReferenceLabel = (relationType: TicketReferenceRelation): string => {
  switch (relationType) {
    case TicketReferenceRelation.DUPLICATE_CONFIRMED:
      return 'Duplicated By';
    case TicketReferenceRelation.DUPLICATE_POSSIBLE:
      return 'Possibly Duplicated By';
    case TicketReferenceRelation.LINKED:
    default:
      return 'Linked By';
  }
};

export const useTicketReferences = ({
  ticketId,
  projectTickets,
  referencesOut,
}: UseTicketReferencesParams): UseTicketReferencesResult => {
  const zero = useZero();
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [isReferenceSaving, setIsReferenceSaving] = useState(false);

  const referenceTicketOptions = useMemo<SelectorOption[]>(() => {
    if (!projectTickets) {
      return [];
    }

    return projectTickets
      .filter(candidate => candidate.id !== ticketId)
      .map(candidate => {
        const label = candidate.title || candidate.xyneId || candidate.id;
        const subtitle = candidate.xyneId || candidate.id;

        return {
          value: candidate.id,
          label,
          subtitle,
          icon: null,
        };
      });
  }, [projectTickets, ticketId]);

  const referenceRelationOptions = useMemo(
    () => [
      {
        value: TicketReferenceRelation.LINKED,
        label: formatReferenceLabel(TicketReferenceRelation.LINKED),
      },
      {
        value: TicketReferenceRelation.DUPLICATE_POSSIBLE,
        label: formatReferenceLabel(TicketReferenceRelation.DUPLICATE_POSSIBLE),
      },
      {
        value: TicketReferenceRelation.DUPLICATE_CONFIRMED,
        label: formatReferenceLabel(TicketReferenceRelation.DUPLICATE_CONFIRMED),
      },
    ],
    [],
  );

  useEffect(() => {
    setReferenceError(null);
    setIsReferenceSaving(false);
  }, [ticketId]);

  const handleAddReference = (targetTicketId: string | null): void => {
    if (!targetTicketId) {
      return;
    }

    if (isReferenceSaving) {
      return;
    }

    if (!ticketId) {
      setReferenceError('Ticket not available yet.');
      return;
    }

    if (targetTicketId === ticketId) {
      setReferenceError('You cannot reference the current ticket.');
      return;
    }

    setReferenceError(null);
    setIsReferenceSaving(true);

    try {
      const existingReference = referencesOut?.find(
        reference => reference.targetTicketId === targetTicketId,
      );

      if (existingReference) {
        setReferenceError('This reference already exists.');
        setIsReferenceSaving(false);
        return;
      }

      if (!existingReference) {
        void zero.mutate(
          mutators.ticketReference.create({
            sourceTicketId: ticketId,
            targetTicketId,
            relationType: TicketReferenceRelation.LINKED,
            timestamp: Date.now(),
            referenceId: uuidv4(),
          }),
        );
      }
    } catch (error) {
      setReferenceError(
        error instanceof Error ? error.message : 'Failed to save ticket reference.',
      );
    }

    setIsReferenceSaving(false);
  };

  const handleRemoveReference = (referenceId: string): void => {
    void zero.mutate(
      mutators.ticketReference.delete({
        id: referenceId,
      }),
    );
  };

  const handleReferenceRelationChange = (
    referenceId: string,
    relationType: TicketReferenceRelation,
  ): void => {
    void zero.mutate(
      mutators.ticketReference.updateRelationType({
        id: referenceId,
        relationType,
        timestamp: Date.now(),
      }),
    );
  };

  return {
    referenceError,
    isReferenceSaving,
    referenceTicketOptions,
    referenceRelationOptions,
    handleAddReference,
    handleRemoveReference,
    handleReferenceRelationChange,
  };
};
