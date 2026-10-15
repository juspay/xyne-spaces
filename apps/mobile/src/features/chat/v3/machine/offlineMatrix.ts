/**
 * Design §12.1 — what each capability does while offline.
 * Consulted only when already offline. Does not read connectivity (C14).
 */

export type OfflineCapability =
  | 'read-warm'
  | 'read-cold'
  | 'send'
  | 'edit'
  | 'delete'
  | 'react'
  | 'paginate'
  | 'attach'
  | 'open-cached-attachment'
  | 'open-uncached-attachment'
  | 'link-preview-fetch'
  | 'jump-outside-warm';

export type OfflineSurface =
  | { kind: 'allow' }
  | { kind: 'queue' }
  | { kind: 'queue-upload' }
  | { kind: 'error'; reason: 'offline-cold' }
  | { kind: 'boundary' }
  | { kind: 'unavailable' }
  | { kind: 'defer' };

export const OFFLINE_COLD_COPY = 'You are offline. Connect and try again.';
export const OFFLINE_UNAVAILABLE_COPY = 'This attachment is unavailable offline.';

export const offlineSurface = (capability: OfflineCapability): OfflineSurface => {
  switch (capability) {
    case 'read-warm':
    case 'open-cached-attachment':
      return { kind: 'allow' };
    case 'send':
    case 'edit':
    case 'delete':
    case 'react':
      return { kind: 'queue' };
    case 'attach':
      return { kind: 'queue-upload' };
    case 'read-cold':
    case 'jump-outside-warm':
      return { kind: 'error', reason: 'offline-cold' };
    case 'paginate':
      return { kind: 'boundary' };
    case 'open-uncached-attachment':
      return { kind: 'unavailable' };
    case 'link-preview-fetch':
      return { kind: 'defer' };
  }
};

/** Explained copy for ❌ cells. Allow/queue/defer/boundary have no extra chrome. */
export const offlineCopy = (surface: OfflineSurface): string | null => {
  switch (surface.kind) {
    case 'error':
      return OFFLINE_COLD_COPY;
    case 'unavailable':
      return OFFLINE_UNAVAILABLE_COPY;
    case 'allow':
    case 'queue':
    case 'queue-upload':
    case 'boundary':
    case 'defer':
      return null;
  }
};
