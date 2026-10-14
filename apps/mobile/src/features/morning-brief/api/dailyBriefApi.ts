import { apiGet, apiPost, apiPostText, apiPut } from '@/src/services/apiClient';

/**
 * Daily Brief API (proxied by the backend to xyne-claw-auth).
 * Ported from dashboard/src/api/dailyBriefApi.ts — the types mirror
 * `DailyBriefPayload` in xyne-claw/src/daily-brief.ts (snake_case keys match
 * the persisted wire contract). Every section is an array of prose lines that
 * may carry markdown and inline `[clf-…#N]` citation tokens.
 */

/** A structured citation attached to a claw tool invocation. Subset of the
 *  dashboard's `ClawCitation` (XyneAITypes.ts) that the brief needs. */
export interface BriefCitation {
  label?: string;
  kind: 'thread' | 'canvas' | 'ticket' | 'external' | 'collection-item' | 'recording';
  channelId?: string;
  conversationId?: string;
  messageId?: string;
  channelName?: string;
  channelKind?: string;
  canvasId?: string;
  recordingId?: string;
  viewAccessId?: string;
  ticketId?: string;
  xyneId?: string;
  mailId?: string;
  url?: string;
  iconKey?: string;
  iconUrl?: string;
  fileName?: string;
  chunkIndex?: number;
}

export interface BriefToolInvocation {
  toolCallId: string;
  citations?: BriefCitation[];
}

/* eslint-disable @typescript-eslint/naming-convention */
export interface DailyBriefPayload {
  generated_for: string;
  date: string;
  what_needs_you: string[];
  overdue: string[];
  waiting_on_others: string[];
  assigned_to_you: string[];
  todays_schedule: string[];
  /** Slimmed toolInvocations baked in at write time. Absent on briefs
   *  generated before citation baking, or when the brief cites nothing. */
  clawCitations?: BriefToolInvocation[];
  /** De-duplicated `iconKey → data:URI` map for the citations above. */
  clawCitationIcons?: Record<string, string>;
}
/* eslint-enable @typescript-eslint/naming-convention */

export type DailyBriefStatus = 'none' | 'generating' | 'ready' | 'failed';

/** A stored brief as returned by GET /daily-brief/latest. */
export interface DailyBriefLatest {
  /** Lifecycle: 'none' (never generated) | 'generating' | 'ready' | 'failed'. */
  status: string;
  /** Calendar bucket the brief is for, e.g. "2026-07-29". Absent when status==='none'. */
  date?: string;
  /** Rendered markdown — the fallback when `data` is missing. */
  content?: string;
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

/** Per-user brief config: the enable flag + custom instructions (GET/PUT /config). */
export interface DailyBriefConfig {
  /** Master opt-in for the scheduled brief. Not the instructions flag. */
  enabled: boolean;
  instructions: string;
  /** Whether the stored instructions are applied to a run. */
  instructionsEnabled: boolean;
  updatedAt?: string | null;
}

/** Server-side cap on the instructions field (claw-auth MAX_INSTRUCTIONS). */
export const DAILY_BRIEF_INSTRUCTIONS_LIMIT = 8000;

export type BriefSwitchSource = 'history_menu' | 'date_picker';

function normalizeConfig(raw: Partial<DailyBriefConfig> | null | undefined): DailyBriefConfig {
  return {
    enabled: Boolean(raw?.enabled),
    instructions: raw?.instructions ?? '',
    instructionsEnabled: raw?.instructionsEnabled !== false,
    updatedAt: raw?.updatedAt ?? null,
  };
}

export const dailyBriefApi = {
  /** The user's brief enable flag + custom instructions. */
  getConfig: async (): Promise<DailyBriefConfig> =>
    normalizeConfig(await apiGet<Partial<DailyBriefConfig>>('/daily-brief/config')),

  /** Save the enable flag and/or the custom instructions. */
  saveConfig: async (payload: {
    enabled?: boolean;
    instructions?: string;
    instructionsEnabled?: boolean;
  }): Promise<DailyBriefConfig> =>
    normalizeConfig(await apiPut<Partial<DailyBriefConfig>>('/daily-brief/config', payload)),

  /** Today's stored brief (falls back to the most recent one). */
  getLatest: async (): Promise<DailyBriefLatest> => apiGet<DailyBriefLatest>('/daily-brief/latest'),

  /** Recent briefs, newest first. */
  getHistory: async (limit = 30): Promise<DailyBriefHistoryItem[]> => {
    const res = await apiGet<DailyBriefHistoryItem[]>(`/daily-brief/history?limit=${limit}`);
    return Array.isArray(res) ? res : [];
  },

  /** Every day the user has a brief for, newest first — the date picker's calendar. */
  getDates: async (limit = 365): Promise<DailyBriefDate[]> => {
    const res = await apiGet<DailyBriefDate[]>(`/daily-brief/dates?limit=${limit}`);
    return Array.isArray(res) ? res : [];
  },

  /** The stored brief for one YYYY-MM-DD bucket (`status: 'none'` when there isn't one). */
  getByDate: async (date: string): Promise<DailyBriefLatest> =>
    apiGet<DailyBriefLatest>(`/daily-brief/by-date/${encodeURIComponent(date)}`),

  /** Fire-and-forget switch beacon — a failed beacon must never surface to the reader. */
  trackSwitch: async (source: BriefSwitchSource): Promise<void> => {
    try {
      await apiPost('/daily-brief/switched', { source });
    } catch {
      // best-effort telemetry
    }
  },

  /**
   * Re-run the brief now. The backend streams SSE, but the mTLS transport
   * cannot stream — so, like summarize-email-thread, we await the full body
   * and parse it after the fact. Progress labels are lost; the screen shows a
   * static "Generating…" and the 10s /latest poll acts as the safety net if
   * this long request dies before the stream ends.
   */
  regenerate: async (): Promise<{ data: string }> =>
    apiPostText('/daily-brief/regenerate', {
      headers: { Accept: 'text/event-stream' },
    }),
};
