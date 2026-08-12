import axios from 'axios';

export type RecordingLoadFailureKind = 'no-access' | 'unknown';

export interface RecordingLoadFailure {
  kind: RecordingLoadFailureKind;
  serverMessage?: string;
}

export interface RecordingLoadFailureCopy {
  title: string;
  description: string;
}

export function classifyRecordingLoadFailure(error: unknown): RecordingLoadFailure {
  if (!axios.isAxiosError(error)) return { kind: 'unknown' };

  if (error.response?.status === 403) return { kind: 'no-access' };

  const data = error.response?.data as { error?: unknown; message?: unknown } | undefined;
  const raw =
    typeof data?.error === 'string'
      ? data.error
      : typeof data?.message === 'string'
        ? data.message
        : undefined;
  const serverMessage = raw?.trim();

  return { kind: 'unknown', ...(serverMessage ? { serverMessage } : {}) };
}

export function describeRecordingLoadFailure(
  failure: RecordingLoadFailure,
): RecordingLoadFailureCopy {
  if (failure.kind === 'no-access') {
    return {
      title: 'You don’t have access to this recording',
      description:
        'Recordings stay private to the person who made them. Ask them to share it with you — access applies the moment they do, on this same link.',
    };
  }

  return {
    title: 'Couldn’t load this recording',
    // The server's own words beat a generic line whenever it gave us any.
    description: failure.serverMessage ?? 'Something went wrong while loading this recording.',
  };
}
