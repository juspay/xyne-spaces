import type { ChatRow, MessageRowModel } from './chatRow.types';

export type RowSurface = 'date' | 'unread-divider' | 'system' | 'call' | 'message';

type SystemSurfaceModel = Pick<
  MessageRowModel,
  'rowKind' | 'rowType' | 'isFlowJson' | 'ticketPreview' | 'callPreview'
>;

/**
 * Regular SYSTEM rows always use the centered system surface, regardless of
 * body length. Flow JSON, calls, and tickets own distinct surfaces.
 */
export const paintsAsSystemJoin = (model: SystemSurfaceModel): boolean => {
  if (model.rowKind !== 'SYSTEM' && model.rowType !== 'system') return false;
  if (model.isFlowJson || model.ticketPreview || model.callPreview) return false;
  return true;
};

/** V2 renders every Flow-JSON SYSTEM message in the centered system pill. */
export const paintsAsSystemFlow = (
  model: Pick<MessageRowModel, 'rowKind' | 'isFlowJson' | 'ticketPreview' | 'callPreview'>,
): boolean =>
  model.rowKind === 'SYSTEM' &&
  model.isFlowJson &&
  model.ticketPreview === null &&
  model.callPreview === null;

const paintsAsCenteredSystem = (model: SystemSurfaceModel): boolean =>
  paintsAsSystemJoin(model) || paintsAsSystemFlow(model);

/** LegendList `getItemType` — one recycler pool per visual shape. */
export const getRowType = (row: ChatRow): string => {
  if (row.type !== 'message') return row.type;
  if (row.model.callPreview) return 'call';
  if (paintsAsSystemFlow(row.model)) return 'system-flow';
  if (paintsAsSystemJoin(row.model)) return 'system';
  if (row.model.threadReplyCount > 0) return 'thread-root';
  if (row.model.isFlowJson) return 'flow';
  if (row.model.rowType === 'system') return 'system-message';
  return row.model.rowType;
};

/** Server conversation id for message rows (C10). Chrome rows keep their synthetic id. */
export const keyExtractor = (row: ChatRow): string => {
  if (row.type === 'message') return row.model.conversationId;
  return row.id;
};

/** Which row component to mount. System is a message-model variant, not a ChatRow type. */
export const rowSurface = (row: ChatRow): RowSurface => {
  if (row.type === 'date') {
    return 'date';
  }
  if (row.type === 'unread-divider') {
    return 'unread-divider';
  }
  if (row.model.callPreview) {
    return 'call';
  }
  if (paintsAsCenteredSystem(row.model)) {
    return 'system';
  }
  return 'message';
};
