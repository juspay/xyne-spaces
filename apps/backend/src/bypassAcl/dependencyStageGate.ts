import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  dependencyGate,
  dependencyPolicy,
  meetsSatisfiedWhen,
  toEdges,
  type DependencyContext,
  type DependencyEdge,
  type DependencyBoard,
  type DependencyStage,
  type DependencyReferenceRow,
  type DependencySubTicketMapping,
  type DependencyTicket,
} from '@xyne/shared';
import { rawQuery } from './base';
import { ticketDependenciesEnabled } from '@/services/dependencies/featureFlag';
import { DependencyError } from '@/services/dependencies/types';

export interface DependencySql {
  query(text: string, values: unknown[]): Promise<unknown[]>;
}
export interface DependencyMoveOptions {
  actorId: string;
  workspaceId?: string;
  reason?: string;
  adminOverride?: boolean;
  automation?: boolean;
}
const moves = new AsyncLocalStorage<DependencyMoveOptions>();
export function withDependencyMoveOptions<T>(options: DependencyMoveOptions, fn: () => T): T {
  return moves.run(options, fn);
}
export function currentDependencyMoveOptions() {
  return moves.getStore();
}

export function prismaDependencySql(tx: Prisma.TransactionClient): DependencySql {
  return {
    query: (text, values) =>
      rawQuery(
        [
          'Ticket',
          'Board',
          'Stage',
          'TicketReferenceMapping',
          'TicketSubTicketMapping',
          'SubTicket',
          'User',
          'Resource',
          'ResourceAccess',
          'UserGroup',
          'UserGroupMapping',
          'TicketActivity',
          'TicketDependencyOverride',
        ],
        'dependency gate: parameterized reads, workspace lock, latches and redacted activities on the caller transaction',
        () => tx.$queryRawUnsafe<unknown[]>(text, ...values),
      ),
  };
}
async function rows<T>(sql: DependencySql, text: string, values: unknown[]): Promise<T[]> {
  return (await sql.query(text, values)) as T[];
}
type StoredTicket = DependencyTicket & {
  workspaceId: string;
  channelId: string;
  updatedBy: string;
  isArchived: boolean;
};
type Mapping = DependencySubTicketMapping & { mappedTicketId: string | null };
const TICKET_COLUMNS =
  'id, "workspaceId", "boardId", "channelId", "stageName", "statusV2", eta, "updatedBy", "isArchived"';

export async function dependencyBoardAdmin(
  sql: DependencySql,
  workspaceId: string,
  userId: string,
  boardId: string,
): Promise<boolean> {
  const result = await rows<{ allowed: boolean }>(
    sql,
    `
    SELECT EXISTS (
      SELECT 1 FROM users u JOIN boards b ON b."workspaceId" = u."workspaceId"
      WHERE u.id = $2 AND u."workspaceId" = $1 AND b.id = $3 AND u.role != 'GUEST'
      AND (b."createdBy" = u.id OR EXISTS (
        SELECT 1 FROM resource_access ra JOIN resources r ON r.id = ra."resourceId"
        WHERE ra."workspaceId" = $1 AND r.name = 'LISTPROJECTS' AND ra."accessType" = 'ADMIN'
        AND (ra."userId" = u.id OR EXISTS (
          SELECT 1 FROM user_group_mappings gm JOIN user_groups g ON g.id = gm."userGroupId"
          WHERE gm."userId" = u.id AND gm."workspaceId" = $1 AND g."workspaceId" = $1
          AND g."isActive" = true AND gm."userGroupId" = ra."groupId"
        ))
      ))
    ) AS allowed`,
    [workspaceId, userId, boardId],
  );
  return result[0]?.allowed === true;
}

async function load(sql: DependencySql, ticket: StoredTicket) {
  const values = [ticket.workspaceId, ticket.id];
  const references = await rows<DependencyReferenceRow>(
    sql,
    `SELECT * FROM ticket_reference_mappings
    WHERE "workspaceId" = $1 AND "relationType" = 'BLOCKS'
    AND ("sourceTicketId" = $2 OR "targetTicketId" = $2) LIMIT 20001`,
    values,
  );
  const mappings = await rows<Mapping>(
    sql,
    `SELECT m.*, s."mappedTicketId" FROM ticket_sub_ticket_mappings m
    JOIN sub_tickets s ON s.id = m."subTicketId" AND s."workspaceId" = m."workspaceId"
    WHERE m."workspaceId" = $1 AND (m."ticketId" = $2 OR s."mappedTicketId" = $2) LIMIT 20001`,
    values,
  );
  if (references.length + mappings.length > 20_000)
    throw new DependencyError(
      'DEPENDENCY_GRAPH_LIMIT',
      'Dependency graph is too large to process safely',
    );
  const edges = toEdges(
    references,
    mappings,
    mappings.map(m => ({ id: m.subTicketId, mappedTicketId: m.mappedTicketId })),
  );
  const ids = [
    ...new Set([ticket.id, ...edges.flatMap(e => [e.blockerTicketId, e.dependentTicketId])]),
  ];
  if (ids.length > 10_000)
    throw new DependencyError(
      'DEPENDENCY_GRAPH_LIMIT',
      'Dependency graph is too large to process safely',
    );
  const tickets = await rows<StoredTicket>(
    sql,
    `SELECT id, "workspaceId", "boardId", "stageName", "statusV2", eta,
    "channelId", "updatedBy", "isArchived" FROM tickets WHERE "workspaceId" = $1 AND id = ANY($2::text[])`,
    [ticket.workspaceId, ids],
  );
  if (tickets.length !== ids.length)
    throw new DependencyError('DEPENDENCY_INVALID_GRAPH', 'Dependency graph requires repair');
  return { edges, tickets };
}
async function contextFor(
  sql: DependencySql,
  workspaceId: string,
  tickets: StoredTicket[],
  targetBoardId: string,
): Promise<DependencyContext> {
  const ids = [...new Set([targetBoardId, ...tickets.map(t => t.boardId)])];
  const boards = await rows<DependencyBoard>(
    sql,
    'SELECT id, "boardType", metadata FROM boards WHERE "workspaceId" = $1 AND id = ANY($2::text[])',
    [workspaceId, ids],
  );
  const stages = await rows<DependencyStage>(
    sql,
    'SELECT id, "boardId", name, "sequenceNumber", "defaultTicketStatusV2" FROM stages WHERE "workspaceId" = $1 AND "boardId" = ANY($2::text[]) LIMIT 20001',
    [workspaceId, ids],
  );
  if (stages.length > 20_000)
    throw new DependencyError(
      'DEPENDENCY_GRAPH_LIMIT',
      'Dependency graph is too large to process safely',
    );
  return {
    ticketsById: new Map(tickets.map(t => [t.id, t])),
    boardsById: new Map(boards.map(b => [b.id, b])),
    stagesByBoard: new Map(ids.map(id => [id, stages.filter(s => s.boardId === id)])),
  };
}
function satisfied(edge: DependencyEdge, context: DependencyContext): boolean {
  const ticket = context.ticketsById.get(edge.blockerTicketId);
  const board = ticket && context.boardsById.get(ticket.boardId);
  const stages = board ? (context.stagesByBoard.get(board.id) ?? []) : [];
  const stage = stages.find(s => s.name === ticket?.stageName);
  return !!(board && stage && meetsSatisfiedWhen(edge, board, stages, stage));
}
/** User-authored text is private even when both endpoints are currently readable. */
export async function auditDependencyOverride(
  sql: DependencySql,
  workspaceId: string,
  edge: DependencyEdge,
  actorId: string,
  reason: string,
  action: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO "non_zero"."ticket_dependency_overrides"
    (id, "workspaceId", "ticketId", "edgeId", "edgeKind", "actorId", action, reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      workspaceId,
      edge.dependentTicketId,
      edge.id,
      edge.kind,
      actorId,
      action,
      reason,
    ],
  );
}

async function stamp(
  sql: DependencySql,
  workspaceId: string,
  edge: DependencyEdge,
  actorId: string,
  kind: 'satisfied' | 'review' | 'override',
  reason?: string,
): Promise<void> {
  // Identifiers below are closed constants, never values from a request.
  const table = edge.kind === 'BLOCKS' ? 'ticket_reference_mappings' : 'ticket_sub_ticket_mappings';
  if (kind === 'review' && edge.kind !== 'BLOCKS') return;
  const assignments =
    kind === 'satisfied'
      ? '"satisfiedAt" = NOW(), "overriddenAt" = NULL, "overriddenBy" = NULL, "overrideReason" = NULL' +
        (edge.kind === 'BLOCKS' ? ', "reviewNeededAt" = NULL' : '')
      : kind === 'review'
        ? '"reviewNeededAt" = COALESCE("reviewNeededAt", NOW())'
        : '"overriddenAt" = NOW(), "overriddenBy" = $3, "overrideReason" = $4';
  const changed = await rows<{ id: string }>(
    sql,
    `UPDATE ${table} SET ${assignments}
    WHERE id = $1 AND "workspaceId" = $2 AND "satisfiedAt" IS NULL
    ${kind === 'review' ? 'AND "reviewNeededAt" IS NULL' : ''} RETURNING id`,
    kind === 'override' ? [edge.id, workspaceId, null, null] : [edge.id, workspaceId],
  );
  if (!changed.length) return;
  if (kind === 'override')
    await auditDependencyOverride(sql, workspaceId, edge, actorId, reason ?? '', 'STAGE_OVERRIDE');
  // No other endpoint id or user-authored reason enters a synchronized activity.
  await sql.query(
    `INSERT INTO ticket_activities (id, "workspaceId", "ticketId", "updatedBy", timestamp, "activityType", "channelId", value)
    SELECT $1, $2, id, $3, NOW(), 'REFERENCE_TICKET', "channelId", $5::jsonb FROM tickets
    WHERE id = $4 AND "workspaceId" = $2`,
    [
      randomUUID(),
      workspaceId,
      actorId,
      edge.dependentTicketId,
      JSON.stringify({ relationType: edge.kind, action: kind }),
    ],
  );
}

/** Caller MUST supply its existing transaction. All reads, latches, overrides and write roll back together. */
export async function dependencyTicketWrite<T>(
  sql: DependencySql,
  ticketId: string,
  data: Record<string, unknown>,
  options: DependencyMoveOptions,
  write: () => Promise<T>,
  enabled: (workspaceId: string) => Promise<boolean> = ticketDependenciesEnabled,
): Promise<T> {
  if (
    options.reason != null &&
    (typeof options.reason !== 'string' || options.reason.trim().length > 2000)
  )
    throw new DependencyError('DEPENDENCY_INPUT', 'Invalid dependency override reason', 400);
  const initial = (
    await rows<StoredTicket>(sql, `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`, [ticketId])
  )[0];
  if (initial && options.workspaceId && initial.workspaceId !== options.workspaceId)
    throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Ticket not found', 404);
  if (!initial || !(await enabled(initial.workspaceId))) return write();
  const lock = await rows<{ locked: boolean }>(
    sql,
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
    [`link-subticket:ws:${initial.workspaceId}`],
  );
  if (!lock[0]?.locked)
    throw new DependencyError('DEPENDENCY_BUSY', 'Another dependency change is in progress; retry');
  const ticket = (
    await rows<StoredTicket>(
      sql,
      `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND "workspaceId" = $2 FOR UPDATE`,
      [ticketId, initial.workspaceId],
    )
  )[0];
  if (!ticket) throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Ticket not found', 404);
  const { edges, tickets } = await load(sql, ticket);
  const targetBoardId = typeof data.boardId === 'string' ? data.boardId : ticket.boardId;
  const context = await contextFor(sql, ticket.workspaceId, tickets, targetBoardId);
  // Recover missed latches before classifying. Reopened blockers cannot clear a persisted latch.
  for (const edge of edges) {
    if (edge.satisfiedAt == null && satisfied(edge, context)) {
      await stamp(sql, ticket.workspaceId, edge, options.actorId, 'satisfied');
      edge.satisfiedAt = new Date();
    }
  }
  const board = context.boardsById.get(targetBoardId);
  const stages = context.stagesByBoard.get(targetBoardId) ?? [];
  const targetName = typeof data.stageName === 'string' ? data.stageName : ticket.stageName;
  const target = stages.find(s => s.name === targetName);
  const moving =
    targetBoardId !== ticket.boardId ||
    targetName !== ticket.stageName ||
    (typeof data.statusV2 === 'string' && data.statusV2 !== ticket.statusV2);
  if (
    moving &&
    (!board ||
      !target ||
      (typeof data.statusV2 === 'string' && target.defaultTicketStatusV2 !== data.statusV2))
  ) {
    throw new DependencyError(
      'DEPENDENCY_STAGE',
      'A valid destination stage and matching status are required',
      400,
    );
  }
  const overrides: DependencyEdge[] = [];
  if (moving && target && board) {
    const candidate = {
      ...ticket,
      boardId: targetBoardId,
      stageName: targetBoardId === ticket.boardId ? ticket.stageName : '\u0000previous-board',
    };
    const gate = dependencyGate(candidate, target.id, edges, context);
    const reason = options.reason?.trim();
    const canAdminOverride =
      gate.hard.length > 0 &&
      !options.automation &&
      (await dependencyBoardAdmin(sql, ticket.workspaceId, options.actorId, board.id));
    const refusal = { softCount: gate.soft.length, hardCount: gate.hard.length, canAdminOverride };
    if (gate.hard.length && !(canAdminOverride && options.adminOverride && reason)) {
      throw new DependencyError(
        'DEPENDENCY_HARD_GATE',
        'Unresolved dependencies prevent this stage move',
        409,
        refusal,
      );
    }
    if (
      gate.soft.length &&
      options.automation &&
      dependencyPolicy(board.metadata).automationOnSoftGate === 'STOP'
    ) {
      throw new DependencyError(
        'DEPENDENCY_AUTOMATION_STOP',
        'Board policy prevents this automatic stage move',
      );
    }
    if (gate.soft.length && !options.automation && !reason) {
      throw new DependencyError(
        'DEPENDENCY_REASON_REQUIRED',
        'A reason is required to proceed past unresolved dependencies',
        409,
        refusal,
      );
    }
    overrides.push(...gate.hard, ...gate.soft);
  }
  const result = await write();
  const persisted = (
    await rows<StoredTicket>(
      sql,
      `SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1 AND "workspaceId" = $2`,
      [ticketId, ticket.workspaceId],
    )
  )[0];
  // Conditional/bulk writes can legitimately match zero rows. Never stamp the requested (but unapplied) transition.
  if (
    !persisted ||
    (moving &&
      persisted.boardId === ticket.boardId &&
      persisted.stageName === ticket.stageName &&
      persisted.statusV2 === ticket.statusV2)
  )
    return result;
  for (const edge of overrides)
    await stamp(
      sql,
      ticket.workspaceId,
      edge,
      options.actorId,
      'override',
      options.automation ? 'automation' : options.reason!.trim(),
    );
  const next = persisted;
  const after: DependencyContext = {
    ...context,
    ticketsById: new Map([...context.ticketsById, [ticket.id, next]]),
  };
  for (const edge of edges) {
    if (edge.blockerTicketId !== ticket.id || edge.satisfiedAt != null) continue;
    if (satisfied(edge, after))
      await stamp(sql, ticket.workspaceId, edge, options.actorId, 'satisfied');
    else if (next.isArchived || (moving && next.statusV2 === 'CANCELLED'))
      await stamp(sql, ticket.workspaceId, edge, options.actorId, 'review');
  }
  return result;
}

/** Zero's pg adapter exposes this same in-flight connection; never open a second transaction. */
export function zeroDependencySql(tx: unknown): DependencySql {
  const candidate = tx as {
    dbTransaction?: { query?: (text: string, values: unknown[]) => Promise<unknown[]> };
  };
  const connection = candidate.dbTransaction;
  if (!connection || typeof connection.query !== 'function')
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Stage writes require a server transaction',
    );
  return {
    query: (text, values) =>
      rawQuery(
        [
          'Ticket',
          'Board',
          'Stage',
          'TicketReferenceMapping',
          'TicketSubTicketMapping',
          'SubTicket',
          'User',
          'Resource',
          'ResourceAccess',
          'UserGroup',
          'UserGroupMapping',
          'TicketActivity',
          'TicketDependencyOverride',
        ],
        'Zero dependency gate must use the same server transaction as its authorized ticket write',
        () => connection.query!(text, values),
      ),
  };
}

export function dependencyRequestMoveOptions(
  actorId: string,
  input: unknown,
  automation = false,
): DependencyMoveOptions {
  if (input == null) return { actorId, automation };
  if (typeof input !== 'object' || Array.isArray(input))
    throw new DependencyError('DEPENDENCY_INPUT', 'Invalid dependency override', 400);
  const data = input as Record<string, unknown>;
  const nested = data.dependencyOverride;
  if (
    nested !== undefined &&
    (data.dependencyReason !== undefined || data.dependencyAdminOverride !== undefined)
  )
    throw new DependencyError('DEPENDENCY_INPUT', 'Choose one dependency override format', 400);
  if (
    nested !== undefined &&
    (!nested ||
      typeof nested !== 'object' ||
      Array.isArray(nested) ||
      Object.keys(nested).some(key => !['reason', 'adminOverride'].includes(key)))
  )
    throw new DependencyError('DEPENDENCY_INPUT', 'Invalid dependency override', 400);
  const intent =
    nested === undefined
      ? { reason: data.dependencyReason, adminOverride: data.dependencyAdminOverride }
      : (nested as Record<string, unknown>);
  if (
    intent.reason !== undefined &&
    (typeof intent.reason !== 'string' ||
      !intent.reason.trim() ||
      intent.reason.trim().length > 2000)
  )
    throw new DependencyError('DEPENDENCY_INPUT', 'Invalid dependency override reason', 400);
  if (intent.adminOverride !== undefined && typeof intent.adminOverride !== 'boolean')
    throw new DependencyError('DEPENDENCY_INPUT', 'Invalid dependency override', 400);
  return {
    actorId,
    automation,
    reason: typeof intent.reason === 'string' ? intent.reason.trim() : undefined,
    adminOverride: intent.adminOverride === true,
  };
}
