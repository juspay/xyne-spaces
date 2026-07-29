import { ReactElement } from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { ReleaseStagePicker, type ReleaseStageOption } from './ReleaseStagePicker';

interface DevTicketStagePickerProps {
  /** Dev ticket id (tickets.id), already loaded by the parent's ART query. */
  ticketId: string;
  stageName: string | null;
  /** Stage options for the dev ticket's board, from the parent's stagesByBoard map. */
  stages: ReleaseStageOption[];
  artId: string | null;
  /** Called instead of mutating when user picks a CANCELLED stage (needs failure-reason confirm). */
  onCancelled: (stage: ReleaseStageOption) => void;
}

/**
 * Stage picker for a dev ticket row in the Testing tab.
 * Receives the dev ticket fields and board stages from the parent (which
 * already loads them via the ART query) — mounting per-row queries here
 * multiplied into an N+1 against zero-cache. Either fires
 * `applicationReleaseTicket.updateStatus` directly or delegates to
 * `onCancelled` when the chosen stage maps to CANCELLED status.
 */
export const DevTicketStagePicker = ({
  ticketId,
  stageName,
  stages,
  artId,
  onCancelled,
}: DevTicketStagePickerProps): ReactElement => {
  const zero = useZero();

  const handleSelect = (stage: ReleaseStageOption): void => {
    if (stage.defaultTicketStatusV2 === TicketStatusV2.CANCELLED) {
      // Defer mutation — wait for user to confirm failure reason in the dialog.
      onCancelled(stage);
      return;
    }
    if (artId) {
      void zero.mutate(
        mutators.applicationReleaseTicket.updateStatus({
          id: artId,
          stageName: stage.name,
          defaultTicketStatusV2: stage.defaultTicketStatusV2 ?? undefined,
          timestamp: Date.now(),
        }),
      );
    }
  };

  return (
    <ReleaseStagePicker
      ticketId={ticketId}
      stageName={stageName}
      stages={stages}
      onSelect={handleSelect}
    />
  );
};
