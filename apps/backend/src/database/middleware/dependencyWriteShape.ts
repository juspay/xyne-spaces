import { Prisma } from '@prisma/client';
import { DependencyError } from '@/services/dependencies/types';

const stageFields = new Set(['stageName', 'statusV2', 'boardId', 'isArchived', 'eta']);
const relations = new Map(
  Prisma.dmmf.datamodel.models.map(model => [
    model.name,
    new Map(model.fields.filter(field => field.kind === 'object').map(field => [field.name, field.type])),
  ]),
);

type Row = Record<string, unknown>;
function object(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Row : undefined;
}
function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Normalize a relational board connect for classification, without rewriting the Prisma write. */
export function dependencyBoardDestination(data: Row): string | undefined {
  if (!('board' in data)) return undefined;
  const board = object(data.board);
  // Updating the existing board does not move the ticket. Nested policy edits are checked below.
  if (board && Object.keys(board).every(key => key === 'update')) return undefined;
  const connect = board && object(board.connect);
  if (!board || Object.keys(board).length !== 1 || !connect || typeof connect.id !== 'string') {
    throw unsupported();
  }
  return connect.id;
}

function unsupported(): DependencyError {
  return new DependencyError(
    'DEPENDENCY_UNSUPPORTED_WRITER',
    'Use an explicit ticket transition or board policy update',
  );
}

/**
 * Prisma query extensions do not observe nested model writes. Follow only schema relations,
 * never JSON content, and refuse changes that would bypass a top-level guard. The caller
 * invokes this at the final ACL-approved continuation; this performs no privileged reads.
 */
export function assertSupportedDependencyWriteShape(
  model: string,
  operation: string,
  input: unknown,
  protectTicketStages: boolean,
): void {
  const args = object(input);
  if (!args) return;
  type Frame = { model: string; data: unknown; nested: boolean; updating: boolean };
  const pending: Frame[] = [];
  const add = (target: string, data: unknown, nested: boolean, updating: boolean) => {
    for (const row of values(data)) if (object(row)) pending.push({ model: target, data: row, nested, updating });
  };
  // Bulk scalar operations cannot contain Prisma nested relation writes. Their own
  // ticket/board guards still enforce stage and policy changes.
  if (operation === 'update') add(model, args.data, false, true);
  else if (operation === 'create') add(model, args.data, false, false);
  else if (operation === 'upsert') {
    add(model, args.update, false, true);
    add(model, args.create, false, false);
  } else return;

  // Bound traversal independently of nesting depth, including malformed/cyclic in-process inputs.
  let count = 0;
  while (pending.length) {
    if (++count > 10_000) throw unsupported();
    const frame = pending.pop()!;
    const data = object(frame.data)!;
    if (frame.nested && frame.updating) {
      if (frame.model === 'Board' && 'metadata' in data) throw unsupported();
      if (protectTicketStages && frame.model === 'Ticket' &&
        (Object.keys(data).some(key => stageFields.has(key)) ||
          ('board' in data && dependencyBoardDestination(data) !== undefined))) throw unsupported();
    }
    for (const [field, target] of relations.get(frame.model) ?? []) {
      const relation = object(data[field]);
      if (!relation) continue;
      // Inverse relation writes change Ticket.boardId without a Ticket update query.
      if (protectTicketStages && frame.model === 'Board' && target === 'Ticket' &&
        ['connect', 'connectOrCreate', 'disconnect', 'set'].some(key => key in relation)) throw unsupported();
      for (const row of values(relation.update)) {
        const update = object(row);
        if (update) add(target, 'data' in update ? update.data : update, true, true);
      }
      for (const row of values(relation.updateMany)) add(target, object(row)?.data, true, true);
      for (const row of values(relation.upsert)) {
        const upsert = object(row);
        if (upsert) {
          add(target, upsert.update, true, true);
          add(target, upsert.create, true, false);
        }
      }
      add(target, relation.create, true, false);
      for (const row of values(relation.connectOrCreate)) add(target, object(row)?.create, true, false);
    }
  }
}
