const EXPANDED_STORAGE_PREFIX = 'xyne.ai.sidebar.projects.expanded';

export function expandedStorageKey(userId: string | undefined): string {
  return userId ? `${EXPANDED_STORAGE_PREFIX}.${userId}` : EXPANDED_STORAGE_PREFIX;
}

export function readExpandedProjectIds(userId: string | undefined): string[] {
  try {
    const raw = window.localStorage.getItem(expandedStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function writeExpandedProjectIds(userId: string | undefined, ids: string[]): void {
  try {
    window.localStorage.setItem(expandedStorageKey(userId), JSON.stringify(ids));
  } catch {
    return;
  }
}

export const DEFAULT_PROJECT_ICON = '📁';

export const PROJECT_NAME_MAX_CHARS = 80;
