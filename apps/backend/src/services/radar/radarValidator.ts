import type { ParserOpenItem, ParserOperation } from '@/services/radar/radarParser';

/**
 * The trust boundary between the parser and the ledger. The model's output is
 * a proposal; nothing it says is taken on faith:
 *
 * - referenced items must exist AND be open (resolved stays resolved — a
 *   resolve/reassign of anything else is dropped, not "fixed"),
 * - pendingOn/requestedBy are filtered to the window's legal user set
 *   (explicit @mentions + message senders — the closed assignment sources;
 *   a name the model guessed simply disappears, which can legally leave an
 *   item ownerless),
 * - sourceMessageId must cite a message actually in the window,
 * - structural no-ops (reassign to the current pendingOn, duplicate resolves)
 *   are dropped so the applier never writes an empty mutation.
 *
 * Pure function: all context is passed in, nothing is read or written here.
 */

export interface ValidationContext {
  openItems: ParserOpenItem[];
  /** messageId -> senderId for every message in the window. */
  windowSenders: Map<string, string>;
  /** The closed legal user set: window @mentions + window senders. */
  allowedUserIds: Set<string>;
}

export interface DroppedOperation {
  op: ParserOperation;
  reason: string;
}

export interface ValidationResult {
  valid: ParserOperation[];
  dropped: DroppedOperation[];
}

/** Hard caps on model output: transaction budget and feed layout both bound. */
const MAX_OPERATIONS = 50;
const MAX_TITLE_CHARS = 200;
const MAX_CONTEXT_CHARS = 500;

export function validateTransitions(
  operations: ParserOperation[],
  ctx: ValidationContext,
): ValidationResult {
  const openById = new Map(ctx.openItems.map(i => [i.id, i]));
  const valid: ParserOperation[] = [];
  const dropped: DroppedOperation[] = [];
  const resolvedThisPass = new Set<string>();

  const legalUsers = (ids: string[] | undefined): string[] =>
    [...new Set(ids ?? [])].filter(id => ctx.allowedUserIds.has(id));

  let batch = operations;
  if (batch.length > MAX_OPERATIONS) {
    // Truncate by PRIORITY, not position: resolve/reassign survive ahead of
    // creates, so an over-long response can't close an item while dropping the
    // create that superseded it.
    const priority = (op: ParserOperation): number => (op.op === 'create' ? 1 : 0);
    const ordered = [...batch].sort((a, b) => priority(a) - priority(b));
    for (const op of ordered.slice(MAX_OPERATIONS)) {
      dropped.push({ op, reason: `over the ${MAX_OPERATIONS}-operation cap for one window` });
    }
    batch = ordered.slice(0, MAX_OPERATIONS);
  }

  for (const op of batch) {
    if (!ctx.windowSenders.has(op.sourceMessageId)) {
      dropped.push({ op, reason: 'sourceMessageId not in window' });
      continue;
    }

    switch (op.op) {
      case 'create': {
        if (!op.title?.trim()) {
          dropped.push({ op, reason: 'create without title' });
          continue;
        }
        const pendingOn = legalUsers(op.pendingOn);
        let requestedBy = legalUsers(op.requestedBy);
        if (requestedBy.length === 0) {
          // Falls back to the sender, but through the same allow-list, so
          // nothing reaches the ledger unverified.
          const sender = ctx.windowSenders.get(op.sourceMessageId);
          requestedBy = sender ? legalUsers([sender]) : [];
        }
        valid.push({
          ...op,
          // Truncate rather than drop: an over-long title is still a real ask.
          title: op.title.trim().slice(0, MAX_TITLE_CHARS),
          contextSummary: op.contextSummary?.trim().slice(0, MAX_CONTEXT_CHARS),
          pendingOn,
          requestedBy,
        });
        continue;
      }

      case 'resolve': {
        if (!op.itemId || !openById.has(op.itemId)) {
          dropped.push({ op, reason: 'resolve of unknown or non-open item' });
          continue;
        }
        if (resolvedThisPass.has(op.itemId)) {
          dropped.push({ op, reason: 'duplicate resolve in one pass' });
          continue;
        }
        resolvedThisPass.add(op.itemId);
        valid.push(op);
        continue;
      }

      case 'reassign': {
        const item = op.itemId ? openById.get(op.itemId) : undefined;
        if (!item) {
          dropped.push({ op, reason: 'reassign of unknown or non-open item' });
          continue;
        }
        if (resolvedThisPass.has(item.id)) {
          dropped.push({ op, reason: 'reassign of item resolved in same pass' });
          continue;
        }
        const pendingOn = legalUsers(op.pendingOn);
        if (pendingOn.length === 0) {
          // An empty pendingOn would drop the item out of everyone's Pending
          // Me. The model omitting the field is not the same as deciding
          // nobody holds the ball, so a reassign must name someone legal.
          dropped.push({ op, reason: 'reassign with no legal assignee' });
          continue;
        }
        const current = [...item.pending_on].sort().join(',');
        if (pendingOn.slice().sort().join(',') === current) {
          dropped.push({ op, reason: 'no-op reassign (pendingOn unchanged)' });
          continue;
        }
        valid.push({ ...op, pendingOn });
        continue;
      }

      default:
        dropped.push({ op, reason: `unknown op "${(op as ParserOperation).op}"` });
    }
  }

  return { valid, dropped };
}
