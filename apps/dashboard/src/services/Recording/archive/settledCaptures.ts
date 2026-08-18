// Local record of captures that are fully settled server-side (MERGED, or
// terminally FAILED). Recovery skips these so a user's KEPT local recording.webm
// is never re-uploaded/re-repaired after the server's Redis state purges. Bounded
// to the most recent ids; older ids age out (by then the server state is long gone).

const KEY = 'xyne-recording-settled-captures';
const MAX = 200;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function isCaptureSettled(captureId: string): boolean {
  return read().includes(captureId);
}

export function markCaptureSettled(captureId: string): void {
  try {
    const ids = read().filter(id => id !== captureId);
    ids.push(captureId);
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    // Best effort; a missed marker only risks a redundant status re-check.
  }
}
