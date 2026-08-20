import { useCallback } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { BoardType } from '@xyne/shared';
import type { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';

/**
 * The slice of a selected row the bulk actions actually need. Structural rather
 * than `Ticket` so callers holding a trimmed selection record — the Desk list
 * view keeps its own lightweight selected-ticket map — can drive them too.
 */
export interface BulkActionTicket {
  id: string;
  boardId?: string | null | undefined;
  projectId?: string | null | undefined;
}

export interface BulkTicketUpdates {
  /** Bare user id — see `assigneeOptionToTicketUpdate` for the encoded picker value. */
  assignedTo?: string | null;
  /** '' clears the group; the mutator ignores null here. */
  userGroupId?: string;
  statusV2?: TicketStatusV2;
  priority?: TicketPriority;
  stageName?: string;
  /**
   * Epoch millis. `ticket.update` types `eta` as an optional number, so a due
   * date can be set but not cleared — callers drop the clear rather than send a
   * null the mutator would silently ignore.
   */
  eta?: number;
}

/**
 * A day picked in the calendar arrives as local midnight, which the server rejects
 * for today ("ETA cannot be set to a past date"). Due dates render day-only, so
 * anchor the eta to the end of the chosen day instead.
 */
export const dueDateToEta = (date: Date): number => {
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime();
};

export interface BulkTicketActions {
  routeStageChange: (
    ticketId: string,
    boardId: string | null | undefined,
    toStageName: string,
  ) => Promise<void>;
  applyUpdates: (tickets: readonly BulkActionTicket[], updates: BulkTicketUpdates) => void;
  applyTags: (tickets: readonly BulkActionTicket[], tagNames: readonly string[]) => void;
}

/**
 * The shape `zero.mutate(...)` returns. Zero applies the mutation optimistically
 * and RESOLVES `.server` with the authoritative result — application errors
 * arrive as `{ type: 'error', error: { message } }` rather than a rejection.
 */
type ZeroMutation = {
  server: Promise<{ type?: string; error?: { message?: string } } | undefined>;
};

/** The server's error message for one mutation, or null when it succeeded. */
const mutationError = async (mutation: ZeroMutation, fallback: string): Promise<string | null> => {
  try {
    const result = await mutation.server;
    return result?.type === 'error' ? result.error?.message || fallback : null;
  } catch (err) {
    return err instanceof Error ? err.message : fallback;
  }
};

/**
 * A bulk action fans one mutation out per ticket, so passing each through the
 * usual per-mutation toast would stack one toast per selected row. Collapse them
 * into a single message naming how many rows the server turned down.
 */
const reportBulkErrors = async (pending: ReadonlyArray<Promise<string | null>>): Promise<void> => {
  const failures = (await Promise.all(pending)).filter((message): message is string => !!message);
  const first = failures[0];
  if (first === undefined) return;
  toast.error(failures.length === 1 ? first : `${first} (${failures.length} tickets not updated)`);
};

/**
 * Mutation half of the multi-select bulk bar, shared by the ticket table (Projects
 * and the Desk table view) and the Desk list view so all three write through the
 * same board-aware paths.
 */
export const useBulkTicketActions = (): BulkTicketActions => {
  const zero = useZero();

  // NON_LINEAR boards reject direct ticket.update — use the transition mutator instead.
  const stageChange = useCallback(
    async (
      ticketId: string,
      boardId: string | null | undefined,
      toStageName: string,
    ): Promise<string | null> => {
      if (boardId) {
        // No try/catch: Zero queries resolve through the cache and don't throw here.
        const board = (await zero.run(queries.boardDetailById({ boardId }), {
          type: 'complete',
        })) as { boardType?: string } | null;
        if (board?.boardType === BoardType.NON_LINEAR) {
          const message = await mutationError(
            zero.mutate(mutators.nonLinear.transition({ ticketId, toStageName, now: Date.now() })),
            'Unable to change stage',
          );
          return message === 'This transition requires a form to be submitted'
            ? 'Open this ticket on its board to fill the required form for this stage'
            : message;
        }
      }
      return mutationError(
        zero.mutate(
          mutators.ticket.update({ id: ticketId, stageName: toStageName, updatedAt: Date.now() }),
        ),
        'Failed to update stage',
      );
    },
    [zero],
  );

  const routeStageChange = useCallback(
    async (
      ticketId: string,
      boardId: string | null | undefined,
      toStageName: string,
    ): Promise<void> => {
      const message = await stageChange(ticketId, boardId, toStageName);
      if (message) toast.error(message);
    },
    [stageChange],
  );

  const applyUpdates = useCallback(
    (tickets: readonly BulkActionTicket[], updates: BulkTicketUpdates): void => {
      const { stageName, ...fields } = updates;
      const hasFields = Object.keys(fields).length > 0;
      const pending: Array<Promise<string | null>> = [];
      for (const ticket of tickets) {
        if (stageName !== undefined) {
          pending.push(stageChange(ticket.id, ticket.boardId, stageName));
        }
        if (hasFields) {
          pending.push(
            mutationError(
              zero.mutate(
                mutators.ticket.update({ id: ticket.id, ...fields, updatedAt: Date.now() }),
              ),
              'Failed to update tickets',
            ),
          );
        }
      }
      void reportBulkErrors(pending);
    },
    [zero, stageChange],
  );

  const applyTags = useCallback(
    (tickets: readonly BulkActionTicket[], tagNames: readonly string[]): void => {
      const pending: Array<Promise<string | null>> = [];
      for (const ticket of tickets) {
        if (!ticket.projectId) continue;
        for (const tagName of tagNames) {
          // The mutator no-ops when the ticket already carries the label, so
          // there's no need to read the current labels before adding.
          pending.push(
            mutationError(
              zero.mutate(
                mutators.ticketTagV2.create({
                  ticketId: ticket.id,
                  tagId: uuidv4(),
                  projectTagId: uuidv4(),
                  mappingId: uuidv4(),
                  projectId: ticket.projectId,
                  tagName,
                }),
              ),
              'Failed to add label',
            ),
          );
        }
      }
      void reportBulkErrors(pending);
    },
    [zero],
  );

  return { routeStageChange, applyUpdates, applyTags };
};
