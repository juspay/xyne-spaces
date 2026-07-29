import type {
  PendingAction,
  PendingActionResolution,
} from '../../components/Chat/XyneAISidebar/utils/XyneAITypes';

const STORAGE_KEY = 'xyne-ai-pending-action-resolutions';
const MAX_RESOLUTIONS = 250;

interface StoredActionResolution {
  resolution: PendingActionResolution;
  resolvedAt: number;
}

export function getPendingActionId(
  sessionId: string,
  messageId: string,
  action: PendingAction,
  actionIndex: number,
): string {
  return action.id || `${sessionId}-${messageId}-${action.tool}-${actionIndex}`;
}

export function getStoredPendingActionResolution(
  actionId: string,
): PendingActionResolution | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return undefined;
    const resolutions = JSON.parse(stored) as Record<string, StoredActionResolution>;
    return resolutions[actionId]?.resolution;
  } catch {
    return undefined;
  }
}

export function storePendingActionResolution(
  actionId: string,
  resolution: PendingActionResolution,
): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const resolutions = stored
      ? (JSON.parse(stored) as Record<string, StoredActionResolution>)
      : {};
    resolutions[actionId] = { resolution, resolvedAt: Date.now() };
    const trimmed = Object.fromEntries(
      Object.entries(resolutions)
        .sort(([, left], [, right]) => right.resolvedAt - left.resolvedAt)
        .slice(0, MAX_RESOLUTIONS),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    return;
  }
}

export function subscribeToPendingActionResolutions(callback: () => void): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}
