import type { OpenAction } from '../machine/openActions';
import type { OpenIntent } from '../intent/openIntent.types';
import { isWarmSchemaCompatible, type WarmSchemaSnapshot } from './schemaGuard';
import { hasPaintableWarmRecords } from './isPaintableWarmRecord';
import type { WarmKind, WarmRow, WarmWindow } from './warmWindow.types';

export type WarmContainment = (kind: WarmKind, value: unknown, messageId: string) => boolean;

export type ReadWarmWindowDeps = {
  readEntity: (kind: WarmKind, id: string, targetMessageId?: string) => unknown | null;
  containsTarget: WarmContainment;
  schema: WarmSchemaSnapshot;
  now: () => number;
};

const idFor = (intent: OpenIntent): { kind: WarmKind; id: string } => {
  if (intent.surface.kind === 'channel') {
    return { kind: 'channel', id: intent.surface.channelId };
  }
  return { kind: 'thread', id: intent.surface.threadId };
};

const asRow = (value: unknown): WarmRow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const conversationId =
    typeof record['conversationId'] === 'string' ? record['conversationId'] : undefined;
  const initialMessageId =
    typeof record['initialMessageId'] === 'string' ? record['initialMessageId'] : null;
  const messageId = typeof record['messageId'] === 'string' ? record['messageId'] : null;
  const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : undefined;
  if (!conversationId && !initialMessageId && !messageId) {
    return null;
  }
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(initialMessageId !== null ? { initialMessageId } : {}),
    ...(messageId !== null ? { messageId } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
};

export const warmRecordsFromEntity = (kind: WarmKind, value: unknown): unknown[] => {
  if (kind === 'channel') {
    return Array.isArray(value) ? value : [];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
};

export const warmRowsFromEntity = (kind: WarmKind, value: unknown): WarmRow[] =>
  warmRecordsFromEntity(kind, value)
    .map(asRow)
    .filter((row): row is WarmRow => row !== null);

const fingerprintFor = (rows: readonly WarmRow[]): string =>
  rows.map(row => row.conversationId ?? row.messageId ?? row.initialMessageId ?? '').join(',');

const targetMessageId = (intent: OpenIntent): string | undefined => {
  const fromHint = intent.hint.messageId?.trim();
  if (fromHint) {
    return fromHint;
  }
  return fromHint;
};

/** Synchronous MMKV read during `resolving`. Inject the adapter so tests stay Expo-free. */
export const readWarmWindow = (intent: OpenIntent, deps: ReadWarmWindowDeps): WarmWindow | null => {
  if (!isWarmSchemaCompatible(deps.schema)) {
    return null;
  }
  const { kind, id } = idFor(intent);
  const messageId = targetMessageId(intent);
  const entity = deps.readEntity(kind, id, messageId);
  if (entity === null) {
    return null;
  }
  const records = warmRecordsFromEntity(kind, entity);
  const rows = records.map(asRow).filter((row): row is WarmRow => row !== null);
  if (rows.length === 0) {
    return null;
  }
  const containsTarget = messageId ? deps.containsTarget(kind, entity, messageId) : true;
  return {
    kind,
    id,
    rows,
    records,
    fingerprint: fingerprintFor(rows),
    readAt: deps.now(),
    containsTarget,
  };
};

export const warmWindowAction = (
  intent: OpenIntent,
  window: WarmWindow | null,
  now: number,
): OpenAction => ({
  type: 'warmWindowRead',
  containsTarget: window?.containsTarget ?? false,
  hasRows: hasPaintableWarmRecords(window),
  now,
  intentKey: intent.intentKey,
});
