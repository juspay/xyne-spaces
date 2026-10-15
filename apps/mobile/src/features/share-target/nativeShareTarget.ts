import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type IncomingSharedFile = {
  uri: string;
  originalUri?: string | null;
  name: string;
  type: string;
  size: number;
};

export type IncomingSharePayload = {
  id: string;
  source: 'android' | 'ios';
  receivedAt: number;
  subject?: string | null;
  text?: string | null;
  files: IncomingSharedFile[];
};

type NativeShareTargetModule = {
  getInitialShare(shareId?: string | null): Promise<IncomingSharePayload | null>;
  clearShare(shareId?: string | null): Promise<boolean>;
  clearAllPendingShares?: () => Promise<boolean>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

export type ShareTargetError = {
  code: string;
  message: string;
};

const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID_PATTERN.test(value);
}

const module = NativeModules['LotusShareTargetModule'] as NativeShareTargetModule | undefined;
const emitter = module ? new NativeEventEmitter(NativeModules['LotusShareTargetModule']) : null;

export const ShareTargetNative = {
  isAvailable: Boolean(module),

  async getInitialShare(shareId?: string | null): Promise<IncomingSharePayload | null> {
    if (!module) return null;
    return module.getInitialShare(shareId ?? null);
  },

  async clearShare(shareId?: string | null): Promise<boolean> {
    if (!module) return false;
    return module.clearShare(shareId ?? null);
  },

  async clearAllPendingShares(): Promise<boolean> {
    // An OTA update can run with an older native binary that does not expose
    // this method yet. Report that capability gap to best-effort logout
    // cleanup, which records it and continues with credential invalidation.
    if (!module?.clearAllPendingShares) return false;
    return module.clearAllPendingShares();
  },

  addReceivedListener(listener: (payload: IncomingSharePayload) => void): () => void {
    if (!emitter || Platform.OS !== 'android') return () => undefined;
    const sub = emitter.addListener('LotusShareTargetReceived', listener);
    return () => sub.remove();
  },

  addErrorListener(listener: (error: ShareTargetError) => void): () => void {
    if (!emitter || Platform.OS !== 'android') return () => undefined;
    const sub = emitter.addListener('LotusShareTargetError', listener);
    return () => sub.remove();
  },
};
