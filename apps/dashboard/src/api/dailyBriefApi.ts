import { apiInstance, BASE_URL } from '../services/clients/apiClient';

/**
 * Daily Brief API (proxied by the backend to xyne-claw-auth).
 *
 * Minimal surface for the Daily Brief dashboard page:
 *   - getLatest()  → today's stored brief (or the most recent one)
 *   - getHistory() → the user's recent briefs, newest first
 *   - getDates()   → every day the user has a brief for (date + status only)
 *   - getByDate()  → the stored brief for one day
 *   - trackSwitch() → beacon: the user switched to another brief
 *   - regenerate() → re-run the brief now, streaming progress over SSE
 *
 * This is intentionally thin — a starting point for UI developers to build on.
 */

/**
 * The structured brief the agent emits (`emit_brief`). Mirrors
 * `DailyBriefPayload` in xyne-claw/src/daily-brief.ts — snake_case keys match
 * the persisted wire contract. Every section is an array of prose lines that
 * may carry markdown and inline `[clf-…#N]` citation tokens.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export interface DailyBriefPayload {
  generated_for: string;
  date: string;
  what_needs_you: string[];
  overdue: string[];
  waiting_on_others: string[];
  assigned_to_you: string[];
  todays_schedule: string[];
  /** Slimmed toolInvocations baked in at write time, same shape as a bot
   *  message's `metadata.clawCitations`. Absent on briefs generated before
   *  citation baking, or when the brief cites nothing. */
  clawCitations?: Array<{ toolCallId: string; citations: unknown[] }>;
  /** De-duplicated `iconKey → data:URI` map for the citations above. */
  clawCitationIcons?: Record<string, string>;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** A stored brief as returned by GET /daily-brief/latest. */
export interface DailyBriefLatest {
  /** Lifecycle: 'none' (never generated) | 'generating' | 'ready' | 'failed'. */
  status: string;
  /** Calendar bucket the brief is for, e.g. "2026-07-29". Absent when status==='none'. */
  date?: string;
  /** Rendered markdown — the fallback when `data` is missing. */
  content?: string;
  /** Structured payload (the emit_brief JSON) alongside the rendered content. */
  data?: DailyBriefPayload | null;
  generatedAt?: string | null;
  /** True when `date` is today's bucket. */
  isToday?: boolean;
}

/** One entry in the history list (GET /daily-brief/history). */
export interface DailyBriefHistoryItem {
  date: string;
  status: string;
  content: string;
  data?: DailyBriefPayload | null;
  agentSlug?: string | null;
  generatedAt?: string | null;
}

/** One day the user has a brief for (GET /daily-brief/dates) — no content. */
export interface DailyBriefDate {
  date: string;
  status: string;
}

/** Callbacks for the regenerate SSE stream. */
export interface RegenerateHandlers {
  onStart?: (date: string | undefined) => void;
  onProgress?: (label: string) => void;
  onComplete?: (payload: { content: string; brief: unknown }) => void;
  onError?: (message: string) => void;
}

/** Per-user brief config: the enable flag + custom instructions (GET/PUT /config). */
export interface DailyBriefConfig {
  /** Master opt-in for the scheduled brief (users.dailyBriefEnabled). Not the instructions flag. */
  enabled: boolean;
  instructions: string;
  /** Whether the stored instructions are applied to a run. */
  instructionsEnabled: boolean;
  updatedAt?: string | null;
}

/** Server-side cap on the instructions field (claw-auth MAX_INSTRUCTIONS). */
export const DAILY_BRIEF_INSTRUCTIONS_LIMIT = 8000;

export const dailyBriefApi = {
  /** The user's brief enable flag + custom instructions. */
  getConfig: async (): Promise<DailyBriefConfig> => {
    const res = await apiInstance.get<DailyBriefConfig>('/daily-brief/config');
    return {
      enabled: Boolean(res.data?.enabled),
      instructions: res.data?.instructions ?? '',
      instructionsEnabled: res.data?.instructionsEnabled !== false,
      updatedAt: res.data?.updatedAt ?? null,
    };
  },

  /** Save the enable flag and/or the custom instructions. */
  saveConfig: async (payload: {
    enabled?: boolean;
    instructions?: string;
    instructionsEnabled?: boolean;
  }): Promise<DailyBriefConfig> => {
    const res = await apiInstance.put<DailyBriefConfig>('/daily-brief/config', payload);
    return {
      enabled: Boolean(res.data?.enabled),
      instructions: res.data?.instructions ?? '',
      instructionsEnabled: res.data?.instructionsEnabled !== false,
      updatedAt: res.data?.updatedAt ?? null,
    };
  },

  /** Today's stored brief (falls back to the most recent one). */
  getLatest: async (): Promise<DailyBriefLatest> => {
    const res = await apiInstance.get<DailyBriefLatest>('/daily-brief/latest');
    return res.data;
  },

  /** Recent briefs, newest first. */
  getHistory: async (limit = 30): Promise<DailyBriefHistoryItem[]> => {
    const res = await apiInstance.get<DailyBriefHistoryItem[]>('/daily-brief/history', {
      params: { limit },
    });
    return Array.isArray(res.data) ? res.data : [];
  },

  /** Every day the user has a brief for, newest first — the date picker's calendar. */
  getDates: async (limit = 365): Promise<DailyBriefDate[]> => {
    const res = await apiInstance.get<DailyBriefDate[]>('/daily-brief/dates', {
      params: { limit },
    });
    return Array.isArray(res.data) ? res.data : [];
  },

  /** The stored brief for one YYYY-MM-DD bucket (`status: 'none'` when there isn't one). */
  getByDate: async (date: string): Promise<DailyBriefLatest> => {
    const res = await apiInstance.get<DailyBriefLatest>(
      `/daily-brief/by-date/${encodeURIComponent(date)}`,
    );
    return res.data;
  },

  /**
   * Tell the server this user switched briefs. Counted server-side because the
   * screen keeps the recent window in memory, so a switch is otherwise invisible.
   * Fire-and-forget: a failed beacon must never surface to the reader.
   */
  trackSwitch: async (source: 'history_menu' | 'date_picker'): Promise<void> => {
    try {
      await apiInstance.post('/daily-brief/switched', { source });
    } catch {
      // best-effort telemetry
    }
  },

  /**
   * Re-run the brief now. Streams `start` / `progress` / `complete` / `error`
   * events (SSE) to the provided handlers. Returns once the stream ends; pass
   * an AbortSignal to cancel (which aborts the underlying run server-side).
   */
  regenerate: async (handlers: RegenerateHandlers, signal?: AbortSignal): Promise<void> => {
    // SSE needs a streamed ReadableStream body — axios (XHR) can't provide one.
    // eslint-disable-next-line local-rules/no-fetch-use-axios
    const response = await fetch(`${BASE_URL}/daily-brief/regenerate`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });

    if (!response.ok || !response.body) {
      handlers.onError?.(`Regenerate failed (${response.status})`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';

    const dispatch = (event: string, dataRaw: string): void => {
      let data: Record<string, unknown> = {};
      try {
        data = dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }
      const asString = (value: unknown, fallback = ''): string =>
        typeof value === 'string' ? value : fallback;
      if (event === 'start') handlers.onStart?.(asString(data['date']) || undefined);
      else if (event === 'progress') handlers.onProgress?.(asString(data['label']));
      else if (event === 'complete')
        handlers.onComplete?.({ content: asString(data['content']), brief: data['brief'] });
      else if (event === 'error')
        handlers.onError?.(asString(data['message'], 'Regeneration failed'));
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            eventType = '';
            continue;
          }
          if (trimmed.startsWith('event:')) eventType = trimmed.slice(6).trim();
          else if (trimmed.startsWith('data:'))
            dispatch(eventType || 'message', trimmed.slice(5).trim());
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* already released */
      }
    }
  },
};
