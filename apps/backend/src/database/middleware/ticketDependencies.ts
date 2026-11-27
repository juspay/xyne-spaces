import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';
import { currentTransactionClient } from '../tenant/acl-extension';
import { getContextOrNull } from '../tenant/context';
import { TICKET_DEPENDENCIES_ENFORCEMENT_READY } from '@/services/dependencies/featureFlag';
import { DependencyError } from '@/services/dependencies/types';
import { currentDependencyMoveOptions, dependencyTicketWrite, prismaDependencySql } from '@/bypassAcl/dependencyStageGate';

const transactionShape = new AsyncLocalStorage<boolean>();
const fields = ['stageName', 'statusV2', 'boardId', 'isArchived', 'eta'];
export function dependencyWriteData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || !fields.some(f => f in value)) return null;
  const data = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key,
    value && typeof value === 'object' && 'set' in value ? value.set : value,
  ]));
}

/** Middleware precedes query extensions. It MUST NOT redirect writes or perform privileged reads. */
export function setupTicketDependencies(prisma: PrismaClient): void {
  prisma.$use((params, next) => !TICKET_DEPENDENCIES_ENFORCEMENT_READY
    ? next(params)
    : transactionShape.run(params.runInTransaction, () => next(params)));
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
  if (!TICKET_DEPENDENCIES_ENFORCEMENT_READY || model !== 'Ticket' || !['update', 'updateMany', 'upsert'].includes(operation)) return execute(input);
  let args = input as WriteArgs;
  const data = dependencyWriteData(args?.data ?? args?.update);
  if (!data) return execute(input);
  if (operation === 'upsert') throw new DependencyError('DEPENDENCY_UNSUPPORTED_WRITER', 'Stage-changing upserts must use a ticket transition');
  const run = async (tx: Prisma.TransactionClient, write: (args: WriteArgs) => Promise<unknown>) => {
    const tickets = await tx.ticket.findMany({ where: args.where, select: { id: true, workspaceId: true }, orderBy: [{ workspaceId: 'asc' }, { id: 'asc' }] });
    if (operation === 'updateMany') {
      // Freeze the checked set: a concurrent insert must not join an already-authorized bulk write.
      args = { ...args, where: { AND: [args.where ?? {}, { id: { in: tickets.map(ticket => ticket.id) } }] } };
    }
    const context = getContextOrNull();
    const explicit = currentDependencyMoveOptions();
    const actorId = (context?.actor === 'user' ? context.userId : undefined) ?? explicit?.actorId ?? (typeof data.updatedBy === 'string' ? data.updatedBy : '');
    const options = {
      ...explicit,
      actorId,
      workspaceId: context && context.actor !== 'system' ? context.workspaceId : explicit?.workspaceId,
      automation: context ? context.actor === 'system' || context.actor === 'service' : explicit?.automation ?? false,
    };
    let guarded = () => write(args);
    for (const ticket of [...tickets].reverse()) {
      const inner = guarded;
      guarded = () => dependencyTicketWrite(prismaDependencySql(tx), ticket.id, data, options, inner);
    }
    return guarded();
  };
  const existing = currentTransactionClient();
  if ((existing || connection) && connection !== existing) throw new DependencyError('DEPENDENCY_UNSUPPORTED_WRITER', 'Stage writes require the active transaction client');
  if (existing) return run(existing, execute);
  // Array transactions have no callback connection in the query extension. Never commit on another one.
  if (transactionShape.getStore()) throw new DependencyError('DEPENDENCY_UNSUPPORTED_WRITER', 'Stage writes require an interactive transaction');
  return rawClient.$transaction(tx => run(tx, checked => operation === 'updateMany'
    ? tx.ticket.updateMany(checked as Prisma.TicketUpdateManyArgs)
    : tx.ticket.update(checked as Prisma.TicketUpdateArgs)), { timeout: 15_000 });
}
