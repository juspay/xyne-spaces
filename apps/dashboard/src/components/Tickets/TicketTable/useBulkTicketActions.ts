import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { BoardType } from '@xyne/shared';
import type { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { useChannelMemberIds } from '../../../hooks/useChannelMemberIds';
import { useActiveUsers } from '../../../hooks/useUsers';
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

/** The channel a selection shares, or undefined when it spans several — or none. */
export const sharedChannelId = (
  tickets: readonly { channelId?: string | null | undefined }[],
): string | undefined => {
  const first = tickets[0]?.channelId;
  if (!first) return undefined;
  return tickets.every(ticket => ticket.channelId === first) ? first : undefined;
};

/**
 * Active users the bulk bar may offer, narrowed to the selection's channel — the bulk
 * equivalent of `useChannelAssignGate`, which keeps non-members off a single ticket.
 * A selection spanning channels has no one member list, so it keeps the full one.
 */
export const useBulkAssignableUsers = (
  channelId: string | undefined,
): ReturnType<typeof useActiveUsers> => {
  const activeUsers = useActiveUsers();
  const { memberIds, loaded } = useChannelMemberIds(channelId);
  return useMemo(
    () => (channelId && loaded ? activeUsers.filter(user => memberIds.has(user.id)) : activeUsers),
    [activeUsers, channelId, loaded, memberIds],
  );
};

/**
 * Ceiling on one bulk action, matching `MAX_TICKETS` in the spaces-create-bulk-tickets
 * MCP tool so both bulk paths bound a batch the same way.
 *
 * A bulk action fans out one mutation per ticket — two when a stage change rides along
 * with other fields, one per tag for labels — and the table view's grid holds every
 * ticket the channel query returned, so an uncapped select-all pushes an unbounded
 * burst. The Desk list view pages at 50 and never reaches this.
 */
export const MAX_BULK_TICKETS = 100;

export interface BulkTicketUpdates {
  /** Bare user id — see `assigneeOptionToTicketUpdate` for the encoded picker value. */
  assignedTo?: string | null;
  /** '' clears the group; the mutator ignores null here. */
  userGroupId?: string;
  statusV2?: TicketStatusV2;
  priority?: TicketPriority;
  /** `statusV2` = the target stage's default; linear boards don't apply it server-side. */
  stage?: { name: string; statusV2?: TicketStatusV2 };
  /** Epoch millis. `ticket.update` can set an eta but not clear it, so callers drop clears. */
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
    toStageStatusV2?: TicketStatusV2,
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
 * Trim a selection to `MAX_BULK_TICKETS`, naming what was left out.
 *
 * Trims rather than refuses: every call site clears the selection immediately after
 * calling, so rejecting outright would drop the user's rows AND change nothing. The
 * grid caps its own select-all, but a hand-built selection still arrives here uncapped.
 */
const capSelection = (tickets: readonly BulkActionTicket[]): readonly BulkActionTicket[] => {
  if (tickets.length <= MAX_BULK_TICKETS) return tickets;
  toast.info(
    `Bulk actions apply to ${MAX_BULK_TICKETS} tickets at a time — updating the first ${MAX_BULK_TICKETS} of ${tickets.length}.`,
  );
  return tickets.slice(0, MAX_BULK_TICKETS);
};

/**
 * Mutation half of the multi-select bulk bar, shared by the ticket table (Projects
 * and the Desk table view) and the Desk list view so all three write through the
 * same board-aware paths.
 */
export const useBulkTicketActions = (): BulkTicketActions => {
  const zero = useZero();

  // `boardDetailById` pulls a whole board to read one field, so a bulk action passes a
  // cache — one lookup per board, not per ticket. Per-action, so it can't go stale.
  const boardTypeOf = useCallback(
    (
      boardId: string,
      cache?: Map<string, Promise<string | undefined>>,
    ): Promise<string | undefined> => {
      const cached = cache?.get(boardId);
      if (cached) return cached;
      // No try/catch: Zero queries resolve through the cache and don't throw here.
      const pending = zero
        .run(queries.boardDetailById({ boardId }), { type: 'complete' })
        .then(board => (board as { boardType?: string } | null)?.boardType);
      cache?.set(boardId, pending);
      return pending;
    },
    [zero],
  );

  // NON_LINEAR boards reject direct ticket.update — use the transition mutator instead.
  const stageChange = useCallback(
    async (
      ticketId: string,
      boardId: string | null | undefined,
      toStageName: string,
      toStageStatusV2?: TicketStatusV2,
      boardTypes?: Map<string, Promise<string | undefined>>,
    ): Promise<string | null> => {
      if (boardId && (await boardTypeOf(boardId, boardTypes)) === BoardType.NON_LINEAR) {
        const message = await mutationError(
          zero.mutate(mutators.nonLinear.transition({ ticketId, toStageName, now: Date.now() })),
          'Unable to change stage',
        );
        return message === 'This transition requires a form to be submitted'
          ? 'Open this ticket on its board to fill the required form for this stage'
          : message;
      }
      return mutationError(
        zero.mutate(
          mutators.ticket.update({
            id: ticketId,
            stageName: toStageName,
            ...(toStageStatusV2 ? { statusV2: toStageStatusV2 } : {}),
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update stage',
      );
    },
    [zero, boardTypeOf],
  );

  const routeStageChange = useCallback(
    async (
      ticketId: string,
      boardId: string | null | undefined,
      toStageName: string,
      toStageStatusV2?: TicketStatusV2,
    ): Promise<void> => {
      const message = await stageChange(ticketId, boardId, toStageName, toStageStatusV2);
      if (message) toast.error(message);
    },
    [stageChange],
  );

  const applyUpdates = useCallback(
    (tickets: readonly BulkActionTicket[], updates: BulkTicketUpdates): void => {
      const { stage, ...fields } = updates;
      const hasFields = Object.keys(fields).length > 0;
      const pending: Array<Promise<string | null>> = [];
      const boardTypes = new Map<string, Promise<string | undefined>>();
      for (const ticket of capSelection(tickets)) {
        if (stage) {
          pending.push(
            stageChange(ticket.id, ticket.boardId, stage.name, stage.statusV2, boardTypes),
          );
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
      for (const ticket of capSelection(tickets)) {
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
