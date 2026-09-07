import { Extension } from '@tiptap/core';
import type { Mark, MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

const canvasTicketUnlinkPluginKey = new PluginKey('canvasTicketUnlink');
const Y_SYNC_META_KEY = 'y-sync$';

interface TextblockRange {
  from: number;
  node: ProseMirrorNode;
  to: number;
}

interface TicketOccurrence {
  from: number;
  mark: Mark;
  ticketId: string;
  to: number;
}

const getTextblockAt = (doc: ProseMirrorNode, position: number): TextblockRange | null => {
  const clampedPosition = Math.max(0, Math.min(position, doc.content.size));
  const positions = [clampedPosition, clampedPosition - 1, clampedPosition + 1];

  for (const candidate of positions) {
    if (candidate < 0 || candidate > doc.content.size) continue;
    const resolved = doc.resolve(candidate);
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const node = resolved.node(depth);
      if (!node.isTextblock) continue;
      return {
        from: resolved.start(depth),
        node,
        to: resolved.end(depth),
      };
    }
  }

  return null;
};

const getTicketOccurrences = (
  range: TextblockRange,
  ticketMarkType: NonNullable<ReturnType<typeof getTicketMarkType>>,
): TicketOccurrence[] => {
  const occurrences: TicketOccurrence[] = [];

  range.node.descendants((node, relativePosition) => {
    if (!node.isText) return;
    const mark = node.marks.find(candidate => candidate.type === ticketMarkType);
    const ticketId = mark?.attrs['stringValue'] as unknown;
    if (!mark || typeof ticketId !== 'string' || !ticketId) return;

    const from = range.from + relativePosition;
    const to = from + node.nodeSize;
    const previous = occurrences.at(-1);
    if (previous?.ticketId === ticketId && previous.to === from) {
      previous.to = to;
      return;
    }

    occurrences.push({ from, mark, ticketId, to });
  });

  return occurrences;
};

const getTicketMarkType = (doc: ProseMirrorNode): MarkType | undefined =>
  doc.type.schema.marks['canvasTicket'];

const getChangedTextblocks = (transaction: Transaction): TextblockRange[] => {
  const ranges = new Map<string, TextblockRange>();

  transaction.mapping.maps.forEach((stepMap, stepIndex) => {
    const remainingMapping = transaction.mapping.slice(stepIndex + 1);
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      const mappedFrom = remainingMapping.map(newFrom, -1);
      const mappedTo = remainingMapping.map(newTo, 1);
      const candidatePositions = [mappedFrom, Math.max(mappedFrom, mappedTo - 1)];

      for (const position of candidatePositions) {
        const range = getTextblockAt(transaction.doc, position);
        if (range) ranges.set(`${range.from}:${range.to}`, range);
      }
    });
  });

  return Array.from(ranges.values());
};

const isRemoteYjsTransaction = (transaction: Transaction): boolean => {
  const metadata = transaction.getMeta(Y_SYNC_META_KEY) as { isChangeOrigin?: boolean } | undefined;
  return metadata?.isChangeOrigin === true;
};

const appendLaterMappings = (transactions: readonly Transaction[], startIndex: number): Mapping => {
  const mapping = new Mapping();
  for (let index = startIndex; index < transactions.length; index += 1) {
    mapping.appendMapping(transactions[index]!.mapping);
  }
  return mapping;
};

export const canvasTicketUnlinkExtension = Extension.create({
  name: 'canvasTicketUnlink',

  addProseMirrorPlugins(): Plugin[] {
    return [
      new Plugin({
        key: canvasTicketUnlinkPluginKey,
        appendTransaction(transactions, _oldState, newState): Transaction | null {
          if (transactions.some(transaction => transaction.getMeta(canvasTicketUnlinkPluginKey))) {
            return null;
          }
          if (!transactions.some(transaction => transaction.docChanged)) return null;
          if (transactions.some(isRemoteYjsTransaction)) return null;

          const finalTicketMarkType = getTicketMarkType(newState.doc);
          if (!finalTicketMarkType) return null;

          const rangesToUnlink = new Map<string, TicketOccurrence>();

          transactions.forEach((transaction, transactionIndex) => {
            if (!transaction.docChanged) return;

            const beforeTicketMarkType = getTicketMarkType(transaction.before);
            const afterTicketMarkType = getTicketMarkType(transaction.doc);
            if (!beforeTicketMarkType || !afterTicketMarkType) return;

            const inverseMapping = transaction.mapping.invert();
            const laterMapping = appendLaterMappings(transactions, transactionIndex + 1);

            for (const afterRange of getChangedTextblocks(transaction)) {
              const beforePosition = inverseMapping.map(afterRange.from, -1);
              const beforeRange = getTextblockAt(transaction.before, beforePosition);
              if (!beforeRange || beforeRange.node.textContent === afterRange.node.textContent) {
                continue;
              }

              const oldTicketIds = new Set(
                getTicketOccurrences(beforeRange, beforeTicketMarkType).map(
                  occurrence => occurrence.ticketId,
                ),
              );
              if (oldTicketIds.size === 0) continue;

              for (const occurrence of getTicketOccurrences(afterRange, afterTicketMarkType)) {
                if (!oldTicketIds.has(occurrence.ticketId)) continue;

                const finalFrom = laterMapping.map(occurrence.from, 1);
                const finalTo = laterMapping.map(occurrence.to, -1);
                if (finalFrom >= finalTo) continue;

                const finalRange = getTextblockAt(newState.doc, finalFrom);
                if (!finalRange) continue;
                const finalOccurrence = getTicketOccurrences(finalRange, finalTicketMarkType).find(
                  candidate => candidate.ticketId === occurrence.ticketId,
                );
                if (!finalOccurrence) continue;

                rangesToUnlink.set(
                  `${finalOccurrence.from}:${finalOccurrence.to}:${finalOccurrence.ticketId}`,
                  finalOccurrence,
                );
              }
            }
          });

          if (rangesToUnlink.size === 0) return null;

          const cleanup = newState.tr;
          for (const occurrence of rangesToUnlink.values()) {
            cleanup.removeMark(occurrence.from, occurrence.to, occurrence.mark);
          }
          cleanup.setMeta(canvasTicketUnlinkPluginKey, true);
          return cleanup;
        },
      }),
    ];
  },
});
