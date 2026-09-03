/**
 * Remembers which recordings the user has asked a summary for.
 *
 * The summary is generated server-side and can take minutes, so the request has to
 * outlive the screen within the current browser session: leaving and coming back
 * must show the skeleton again rather than offering the button a second time.
 * Entries expire so a summary that never arrives cannot strand the skeleton forever.
 */

const STORAGE_KEY = 'xyne:recording-summary-requested';
const REQUEST_TTL_MS = 60 * 60 * 1000;

export interface SummaryRequestState {
  requestedAt: number;
  progress: number;
  stageIndex: number;
  templateId?: string;
}

type RequestMap = Record<string, SummaryRequestState>;

const normalizeProgress = (progress: number): number => Math.min(96, Math.max(0, progress));
const normalizeStageIndex = (stageIndex: number): number => Math.max(0, Math.trunc(stageIndex));

// Reads all pending summary-generation states from the session-storage key.
const read = (): RequestMap => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};

    const requests: RequestMap = {};
    const now = Date.now();
    for (const [recordingId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const request =
        value &&
        typeof value === 'object' &&
        typeof (value as Partial<SummaryRequestState>).requestedAt === 'number' &&
        typeof (value as Partial<SummaryRequestState>).progress === 'number'
          ? (value as SummaryRequestState)
          : null;

      if (request && now - request.requestedAt < REQUEST_TTL_MS) {
        requests[recordingId] = {
          requestedAt: request.requestedAt,
          progress: normalizeProgress(request.progress),
          stageIndex: normalizeStageIndex(
            typeof request.stageIndex === 'number' ? request.stageIndex : 0,
          ),
          ...(typeof request.templateId === 'string' ? { templateId: request.templateId } : {}),
        };
      }
    }
    return requests;
  } catch {
    return {};
  }
};

const write = (map: RequestMap): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Unavailable storage only costs the skeleton its persistence.
  }
};

export const isSummaryRequested = (recordingId: string | null | undefined): boolean =>
  !!recordingId && recordingId in read();

export const getSummaryRequest = (
  recordingId: string | null | undefined,
): SummaryRequestState | null => {
  if (!recordingId) return null;
  return read()[recordingId] ?? null;
};

export const getSummaryProgress = (recordingId: string | null | undefined): number =>
  getSummaryRequest(recordingId)?.progress ?? 0;

export const getSummaryStage = (recordingId: string | null | undefined): number =>
  getSummaryRequest(recordingId)?.stageIndex ?? 0;

export const markSummaryRequested = (
  recordingId: string | null | undefined,
  templateId?: string,
): void => {
  if (!recordingId) return;
  write({
    ...read(),
    [recordingId]: {
      requestedAt: Date.now(),
      progress: 0,
      stageIndex: 0,
      ...(templateId ? { templateId } : {}),
    },
  });
};

export const saveSummaryProgress = (
  recordingId: string | null | undefined,
  progress: number,
  stageIndex: number,
): void => {
  if (!recordingId || !Number.isFinite(progress)) return;
  const map = read();
  const request = map[recordingId];
  // Success/failure may clear the request before the panel cleanup runs.
  if (!request) return;
  write({
    ...map,
    [recordingId]: {
      ...request,
      progress: normalizeProgress(progress),
      stageIndex: normalizeStageIndex(stageIndex),
    },
  });
};

export const clearSummaryRequested = (recordingId: string | null | undefined): void => {
  if (!recordingId) return;
  const map = read();
  delete map[recordingId];
  write(map);
};
