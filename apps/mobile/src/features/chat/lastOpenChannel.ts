import { getJson, setJson } from '@/src/services/localStorage';

const LAST_OPEN_CHANNEL_KEY = '@lotus_chat:last_open_channel';

type StoredChannelRoute = {
  version: 1;
  channelId: string;
  updatedAt: number;
};

const isStoredChannelRoute = (value: unknown): value is StoredChannelRoute =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as StoredChannelRoute).version === 1 &&
  typeof (value as StoredChannelRoute).channelId === 'string' &&
  (value as StoredChannelRoute).channelId.length > 0 &&
  typeof (value as StoredChannelRoute).updatedAt === 'number';

const writeStoredChannelRoute = (key: string, channelId: string): void => {
  if (!channelId) return;
  setJson(key, {
    version: 1,
    channelId,
    updatedAt: Date.now(),
  } satisfies StoredChannelRoute);
};

const readStoredChannelRouteId = (key: string): string | null => {
  const stored = getJson<unknown>(key);
  return isStoredChannelRoute(stored) ? stored.channelId : null;
};

export const rememberLastOpenChannel = (channelId: string): void => {
  writeStoredChannelRoute(LAST_OPEN_CHANNEL_KEY, channelId);
};

export const readLastOpenChannelId = (): string | null =>
  readStoredChannelRouteId(LAST_OPEN_CHANNEL_KEY);
