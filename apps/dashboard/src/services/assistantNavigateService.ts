import { apiInstance } from './clients/apiClient';

export interface NavigateStepRequest {
  goal: string;
  /** The goal is a form behind a button: keep clicking until it opens. */
  formMode: boolean;
  page: { url: string; title: string; headings: string[] };
  history: { url: string; clicked: string; urlAfter: string; changed: boolean }[];
  candidates: { id: string; description: string }[];
}

export type NavigateStepResponse =
  | { status: 'reached'; reached: number }
  | { status: 'click'; id: string; confidence: number; reached: number }
  | { status: 'stuck'; reason: 'none' | 'low_confidence' | 'no_candidates'; reached: number }
  | { status: 'unavailable' };

export type JevDebugAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number };

/** Sent by the backend outside production only: what it asked Jev and what came back. */
export interface NavigateStepDebug {
  jevRequest?: { url: string; model: string; state: unknown; questions: unknown };
  jevAnswers?: Record<string, JevDebugAnswer> | null;
  jevFailure?: { kind: string; status?: number };
  thresholds?: Record<string, unknown>;
  pNone?: number;
  unavailableReason?: string;
  latencyMs: number;
}

export type NavigateStepResult = NavigateStepResponse & {
  debug?: NavigateStepDebug;
  /** Why the call itself failed (network, timeout, bad reply), when it did. */
  error?: string;
};

// Above the backend's 4 s Jev timeout, so that one decides and this only covers the network.
const STEP_DEADLINE_MS = 5000;

const isStepResponse = (body: unknown): body is NavigateStepResponse => {
  if (typeof body !== 'object' || body === null) return false;
  const { status, id } = body as Record<string, unknown>;
  if (status === 'click') return typeof id === 'string';
  return status === 'reached' || status === 'stuck' || status === 'unavailable';
};

// Never throws: any failure reads as `unavailable`, with `error` saying why.
export async function navigateStepWithJev(
  request: NavigateStepRequest,
  signal: AbortSignal,
): Promise<NavigateStepResult> {
  try {
    const response = await apiInstance.post<unknown>('/assistant/navigate/step', request, {
      signal,
      timeout: STEP_DEADLINE_MS,
    });
    return isStepResponse(response.data)
      ? (response.data as NavigateStepResult)
      : { status: 'unavailable', error: 'unexpected response shape' };
  } catch (error) {
    return {
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'request failed',
    };
  }
}

export interface NavigateChooseRequest {
  goal: string;
  kind: 'destination' | 'item';
  itemType?: string;
  currentPage?: { url: string; title: string };
  options: { id: string; description: string }[];
}

export type NavigateChooseResponse =
  | { status: 'chosen'; id: string; confidence: number }
  | { status: 'none'; pNone: number }
  | { status: 'unsure'; id: string; confidence: number }
  | { status: 'unavailable' };

export type NavigateChooseResult = NavigateChooseResponse & {
  debug?: NavigateStepDebug;
  error?: string;
};

const isChooseResponse = (body: unknown): body is NavigateChooseResponse => {
  if (typeof body !== 'object' || body === null) return false;
  const { status, id } = body as Record<string, unknown>;
  if (status === 'chosen' || status === 'unsure') return typeof id === 'string';
  return status === 'none' || status === 'unavailable';
};

// One pick from a list (a destination, or one of the user's items). Never throws.
export async function chooseWithJev(
  request: NavigateChooseRequest,
  signal: AbortSignal,
): Promise<NavigateChooseResult> {
  try {
    const response = await apiInstance.post<unknown>('/assistant/navigate/choose', request, {
      signal,
      timeout: STEP_DEADLINE_MS,
    });
    return isChooseResponse(response.data)
      ? (response.data as NavigateChooseResult)
      : { status: 'unavailable', error: 'unexpected response shape' };
  } catch (error) {
    return {
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'request failed',
    };
  }
}
