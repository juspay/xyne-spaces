/**
 * Remembers which recordings the user has asked a summary for.
 *
 * The summary is generated server-side and can take minutes, so the request has to
 * outlive the screen: leaving and coming back must show the skeleton again rather
 * than offering the button a second time. Entries expire so a summary that never
 * arrives cannot strand the skeleton forever.
 */

const STORAGE_KEY = 'xyne:recording-summary-requested';
const REQUEST_TTL_MS = 60 * 60 * 1000;

type RequestMap = Record<string, number>;

const read = (): RequestMap => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed as RequestMap).filter(
        ([, requestedAt]) => typeof requestedAt === 'number' && now - requestedAt < REQUEST_TTL_MS,
      ),
    );
  } catch {
    return {};
  }
};

const write = (map: RequestMap): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Unavailable storage only costs the skeleton its persistence.
  }
};

export const isSummaryRequested = (recordingId: string | null | undefined): boolean =>
  !!recordingId && recordingId in read();

export const markSummaryRequested = (recordingId: string | null | undefined): void => {
  if (!recordingId) return;
  write({ ...read(), [recordingId]: Date.now() });
};

export const clearSummaryRequested = (recordingId: string | null | undefined): void => {
  if (!recordingId) return;
  const map = read();
  delete map[recordingId];
  write(map);
};
