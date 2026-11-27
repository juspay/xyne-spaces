import { AsyncLocalStorage } from 'node:async_hooks';
import { dependencyPolicy } from '@xyne/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { currentTransactionClient } from '../tenant/acl-extension';
import { getContextOrNull } from '../tenant/context';
import { TICKET_DEPENDENCIES_ENFORCEMENT_READY } from '@/services/dependencies/featureFlag';
import { DependencyError } from '@/services/dependencies/types';
import {
  currentDependencyMoveOptions,
  dependencyBoardAdmin,
  dependencyTicketWrite,
  dependencyBulkStageWrite,
  prismaDependencySql,
} from '@/bypassAcl/dependencyStageGate';

const transactionShape = new AsyncLocalStorage<boolean>();
const fields = ['stageName', 'statusV2', 'boardId', 'isArchived', 'eta'];
export function dependencyWriteData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || !fields.some(f => f in value)) return null;
  const data = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && typeof value === 'object' && 'set' in value ? value.set : value,
    ]),
  );
}

/** Middleware precedes query extensions. It MUST NOT redirect writes or perform privileged reads. */
export function setupTicketDependencies(prisma: PrismaClient): void {
  prisma.$use((params, next) =>
    !TICKET_DEPENDENCIES_ENFORCEMENT_READY && params.model !== 'Board'
      ? next(params)
      : transactionShape.run(params.runInTransaction, () => next(params)),
  );
}

type WriteArgs = { where?: Prisma.TicketWhereInput; data?: unknown; update?: unknown };
/** Called by the ACL extension only at its final, already-authorized query continuation. */
export async function guardTicketDependencyWrite(
  rawClient: PrismaClient,
  model: string,
  operation: string,
  input: unknown,
  execute: (args: unknown) => Promise<unknown>,
  connection?: Prisma.TransactionClient,
): Promise<unknown> {
  if (model === 'Board')
    return guardBoardDependencyWrite(rawClient, operation, input, execute, connection);
  if (
    !TICKET_DEPENDENCIES_ENFORCEMENT_READY ||
    model !== 'Ticket' ||
    !['update', 'updateMany', 'upsert'].includes(operation)
  )
    return execute(input);
  let args = input as WriteArgs;
  const data = dependencyWriteData(args?.data ?? args?.update);
  if (!data) return execute(input);
  if (operation === 'upsert')
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Stage-changing upserts must use a ticket transition',
    );
  const run = async (
    tx: Prisma.TransactionClient,
    write: (args: WriteArgs) => Promise<unknown>,
  ) => {
    const tickets = await tx.ticket.findMany({
      take: 101,
      where: args.where,
      select: { id: true, workspaceId: true },
      orderBy: [{ workspaceId: 'asc' }, { id: 'asc' }],
    });
    if (operation === 'updateMany') {
      // Freeze the checked set: a concurrent insert must not join an already-authorized bulk write.
      args = {
        ...args,
        where: { AND: [args.where ?? {}, { id: { in: tickets.map(ticket => ticket.id) } }] },
      };
    }
    const context = getContextOrNull();
    const explicit = currentDependencyMoveOptions();
    const actorId =
      (context && context.actor !== 'system' ? context.userId : undefined) ??
      explicit?.actorId ??
      '';
    if (tickets.length > 100)
      throw new DependencyError('DEPENDENCY_GRAPH_LIMIT', 'Select at most 100 tickets');
    const options = {
      ...explicit,
      actorId,
      workspaceId:
        context && context.actor !== 'system' ? context.workspaceId : explicit?.workspaceId,
      automation:
        explicit?.automation === true &&
        explicit.actorId === actorId &&
        (!explicit.workspaceId || explicit.workspaceId === context?.workspaceId),
    };
    if (operation === 'updateMany' && tickets.length)
      return dependencyBulkStageWrite(
        prismaDependencySql(tx),
        tickets.map(ticket => ({ id: ticket.id, data })),
        options,
        () => write(args),
      );
    let guarded = () => write(args);
    for (const ticket of [...tickets].reverse()) {
      const inner = guarded;
      guarded = () =>
        dependencyTicketWrite(prismaDependencySql(tx), ticket.id, data, options, inner);
    }
    return guarded();
  };
  const existing = currentTransactionClient();
  if ((existing || connection) && connection !== existing)
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Stage writes require the active transaction client',
    );
  if (existing) return run(existing, execute);
  // Array transactions have no callback connection in the query extension. Never commit on another one.
  if (transactionShape.getStore())
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Stage writes require an interactive transaction',
    );
  return rawClient.$transaction(
    tx =>
      run(tx, checked =>
        operation === 'updateMany'
          ? tx.ticket.updateMany(checked as Prisma.TicketUpdateManyArgs)
          : tx.ticket.update(checked as Prisma.TicketUpdateArgs),
      ),
    { timeout: 15_000 },
  );
}

/** Policy authorization applies even before enforcement rollout; existing metadata edits remain unchanged. */
export async function guardBoardDependencyWrite(
  rawClient: PrismaClient,
  operation: string,
  input: unknown,
  execute: (args: unknown) => Promise<unknown>,
  connection?: Prisma.TransactionClient,
): Promise<unknown> {
  const args = input as {
    where?: Prisma.BoardWhereInput;
    data?: Record<string, unknown>;
    update?: Record<string, unknown>;
  };
  const data = args?.data ?? args?.update;
  if (!['update', 'updateMany', 'upsert'].includes(operation) || !data || !('metadata' in data))
    return execute(input);
  if (operation === 'upsert')
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Dependency policy updates require an existing board',
    );
  const existing = currentTransactionClient();
  if ((existing || connection) && connection !== existing)
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Policy writes require the active transaction client',
    );
  const run = async (
    tx: Prisma.TransactionClient,
    write: (checked: unknown) => Promise<unknown>,
  ) => {
    const boards = await tx.board.findMany({
      where: args.where,
      take: 101,
      select: { id: true, workspaceId: true },
      orderBy: [{ workspaceId: 'asc' }, { id: 'asc' }],
    });
    if (boards.length > 100)
      throw new DependencyError('DEPENDENCY_GRAPH_LIMIT', 'Select at most 100 boards');
    const sql = prismaDependencySql(tx);
    const context = getContextOrNull();
    const trusted = currentDependencyMoveOptions();
    const actorId = context && context.actor !== 'system' ? context.userId : trusted?.actorId;
    const workspaceId =
      context && context.actor !== 'system' ? context.workspaceId : trusted?.workspaceId;
    for (const workspace of [...new Set(boards.map(board => board.workspaceId))].sort()) {
      const lock = await sql.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [
        `link-subticket:ws:${workspace}`,
      ]);
      if (!(lock[0] as { locked?: boolean } | undefined)?.locked)
        throw new DependencyError(
          'DEPENDENCY_BUSY',
          'Another dependency change is in progress; retry',
        );
    }
    // Lock and re-read after serialization. Comparing a stale policy can otherwise hide a reset to SOFT.
    const current = boards.length
      ? await sql.query(
          'SELECT id, "workspaceId", metadata FROM boards WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE',
          [boards.map(board => board.id)],
        )
      : [];
    for (const row of current as Array<{ id: string; workspaceId: string; metadata: unknown }>) {
      if (
        JSON.stringify(dependencyPolicy(data.metadata)) ===
        JSON.stringify(dependencyPolicy(row.metadata))
      )
        continue;
      if (
        !actorId ||
        workspaceId !== row.workspaceId ||
        !(await dependencyBoardAdmin(sql, row.workspaceId, actorId, row.id))
      )
        throw new DependencyError(
          'DEPENDENCY_FORBIDDEN',
          'Only a board administrator can change dependency policy',
          403,
        );
    }
    if (current.length !== boards.length)
      throw new DependencyError('DEPENDENCY_NOT_FOUND', 'Board not found', 404);
    return write({
      ...args,
      ...(operation === 'updateMany'
        ? { where: { AND: [args.where ?? {}, { id: { in: boards.map(board => board.id) } }] } }
        : {}),
    });
  };
  if (existing) return run(existing, execute);
  if (transactionShape.getStore())
    throw new DependencyError(
      'DEPENDENCY_UNSUPPORTED_WRITER',
      'Policy writes require an interactive transaction',
    );
  return rawClient.$transaction(
    tx =>
      run(tx, checked =>
        operation === 'updateMany'
          ? tx.board.updateMany(checked as Prisma.BoardUpdateManyArgs)
          : tx.board.update(checked as Prisma.BoardUpdateArgs),
      ),
    { timeout: 15_000 },
  );
}
