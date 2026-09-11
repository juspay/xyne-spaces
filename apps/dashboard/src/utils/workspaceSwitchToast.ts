/**
 * Carries a toast across the hard reload a workspace switch performs.
 *
 * Switching workspace flips the session cookie via a full-page navigation, which
 * tears down whatever toast was showing before the user can read it. Stash the
 * message just before navigating and the destination page shows it once it mounts.
 * The entry expires so an abandoned/failed navigation can't resurrect a stale toast
 * on some later, unrelated reload.
 */

const STORAGE_KEY = 'xyne:workspace-switch-toast';
const TOAST_TTL_MS = 60 * 1000;

export interface WorkspaceSwitchToast {
  title: string;
  description?: string;
}

interface StoredToast extends WorkspaceSwitchToast {
  storedAt: number;
}

export const setWorkspaceSwitchToast = (toast: WorkspaceSwitchToast): void => {
  try {
    const stored: StoredToast = { ...toast, storedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Unavailable storage only costs the destination toast.
  }
};

export const consumeWorkspaceSwitchToast = (): WorkspaceSwitchToast | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);

    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Partial<StoredToast>).storedAt !== 'number' ||
      typeof (parsed as Partial<StoredToast>).title !== 'string'
    ) {
      return null;
    }

    const stored = parsed as StoredToast;
    if (Date.now() - stored.storedAt >= TOAST_TTL_MS) return null;

    return {
      title: stored.title,
      ...(typeof stored.description === 'string' ? { description: stored.description } : {}),
    };
  } catch {
    return null;
  }
};
