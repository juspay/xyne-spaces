import { BoardType } from '@xyne/shared';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { createSubTicketTx } from '@/bypassAcl/transactions/subTicketService';
import { createFlowSubTicketMappingsTx } from '@/bypassAcl/transactions/subTicketService';

export interface CreateSubTicketInput {
  parentTicketId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  assignedTo?: string | null;
  subTicketId?: string;
  mappingId?: string;
  mappedTicketId?: string | null;
  subTicketXyneId?: string | null;
  timestamp?: Date;
}

export interface CreateSubTicketResult {
  subTicketId: string;
  mappingId: string;
  parentTicketId: string;
  conversationId: string | null;
}

export async function createSubTicket(
  input: CreateSubTicketInput,
): Promise<CreateSubTicketResult> {
  const subTicketId = input.subTicketId ?? uuidv4();
  const mappingId = input.mappingId ?? uuidv4();
  const now = input.timestamp ?? new Date();

  const parent = await db.ticket.findUnique({
    where: { id: input.parentTicketId },
    select: { id: true, conversationId: true, workspaceId: true, board: { select: { boardType: true } } },
  });
  if (!parent) {
    throw new Error(`Parent ticket "${input.parentTicketId}" not found`);
  }

  await createSubTicketTx(subTicketId, input, parent, now, mappingId);

  logger.info(
    `[subTicketService] created subTicket=${subTicketId} parent=${parent.id} mapping=${mappingId}`,
  );

  return {
    subTicketId,
    mappingId,
    parentTicketId: parent.id,
    conversationId: parent.conversationId,
  };
}

export const FLOW_MAPPING_NAMESPACE = 'f34ae343-9aa8-5bcb-8f52-6ea8304435d1';

/**
 * Materialize one FLOW child under every effective parent. One SubTicket row
 * represents the mapped child; TicketSubTicketMapping carries the many-parent
 * relationship. Deterministic ids make cascade retries idempotent.
 */
export async function createFlowSubTicketMappings(input: {
  parentTicketIds: string[];
  mappedTicketId: string;
  rootTicketId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  assignedTo?: string | null;
  subTicketXyneId?: string | null;
  timestamp?: Date;
}): Promise<CreateSubTicketResult> {
  const parentTicketIds = [...new Set(input.parentTicketIds)];
  if (parentTicketIds.length === 0) {
    throw new Error('A Flow sub-ticket requires at least one parent');
  }
  const [parents, child] = await Promise.all([
    db.ticket.findMany({
      where: { id: { in: parentTicketIds } },
      select: {
        id: true,
        boardId: true,
        workspaceId: true,
        conversationId: true,
        metadata: true,
        board: { select: { boardType: true } },
      },
    }),
    db.ticket.findUnique({
      where: { id: input.mappedTicketId },
      select: { id: true, boardId: true, metadata: true },
    }),
  ]);
  if (!child || parents.length !== parentTicketIds.length) {
    throw new Error('Flow child or one of its parents was not found');
  }
  const childFlow = (child.metadata as { flow?: { rootTicketId?: string } } | null)?.flow;
  if (childFlow?.rootTicketId !== input.rootTicketId) {
    throw new Error('Flow child does not belong to the requested run');
  }
  for (const parent of parents) {
    const parentFlow = (parent.metadata as { flow?: { rootTicketId?: string } } | null)?.flow;
    const parentRootTicketId = parentFlow?.rootTicketId ?? parent.id;
    if (
      parent.board.boardType !== BoardType.FLOW ||
      parent.boardId !== child.boardId ||
      parentRootTicketId !== input.rootTicketId
    ) {
      throw new Error('Flow multi-parent mappings must stay within one board run');
    }
  }

  const now = input.timestamp ?? new Date();
  const subTicketId = uuidv5(
    `flow-subticket:${input.rootTicketId}:${input.mappedTicketId}`,
    FLOW_MAPPING_NAMESPACE,
  );
  const primaryParent = parents[0]!;

  await createFlowSubTicketMappingsTx(subTicketId, input, primaryParent, now, parents);

  return {
    subTicketId,
    mappingId: uuidv5(`flow-mapping:${primaryParent.id}:${subTicketId}`, FLOW_MAPPING_NAMESPACE),
    parentTicketId: primaryParent.id,
    conversationId: primaryParent.conversationId,
  };
}

