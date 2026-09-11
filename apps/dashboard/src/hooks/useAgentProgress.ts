import { logger, Event as LogEvent } from '../utils/logger';
import { useEffect, useRef, useState } from 'react';
import { websocketService } from '../services/clients/socketClient';
import {
  pickRandomAgentSpinnerVariant,
  type AgentSpinnerVariant,
} from '../components/ui/AgentSpinner';
import { apiInstance } from '../services/clients/apiClient';
import { MessageType } from '@xyne/shared';

/**
 * Ephemeral agent-progress state.
 *
 * Subscribes to WebSocket session_activity events and surfaces the
 * "agent is working" pill next to the chat input — same transport as the
 * typing indicator. No DB row; purely transient.
 *
 * Transport: xyne-claw-auth → spaces /api/apps/chat/agentProgress →
 *            redisService.broadcastMessageToSession(channelId, SYSTEM event).
 * Event content: JSON.parse(msg.content).type === 'agent_progress'.
 */
export interface ActiveAgent {
  agentSlug: string | null;
  agentName: string | null;
  agentUserId: string | null;
  toolLabel: string | null;
  /** Human who started the run — only this user may stop it (gates the Stop button). */
  triggeredByUserId: string | null;
  /** Rotates whenever toolLabel changes — stays stable across heartbeats of the same label. */
  variant: AgentSpinnerVariant;
  at: number; // last-seen timestamp (ms), used to drop stale entries
}

interface AgentProgressData {
  type: 'agent_progress';
  data: {
    conversationId?: string;
    channelId?: string;
    agentSlug?: string | null;
    agentName?: string | null;
    agentUserId?: string | null;
    /** Run id. Scopes done-suppression so a straggler from a finished run can't resurrect the spinner. */
    sessionId?: string | null;
    toolLabel?: string | null;
    status?: 'working' | 'done';
    triggeredByUserId?: string | null;
  };
}

// Drop entries we haven't heard from in this long (ms). Real agent runs can have
// individual tool calls lasting several minutes (RAG, LLM calls, DB scans), so the
// stale window is a crash-safety backstop, not a per-tool budget. The `status: 'done'`
// signal from claw-auth clears the spinner immediately when an agent actually finishes.
const STALE_MS = 10 * 60 * 1000;

interface SessionActivityEvent {
  sessionId: string;
  message: {
    messageId: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    content: string;
    msgType: MessageType;
    createdAt: Date;
  };
}

export interface UseAgentProgressResult {
  agents: ActiveAgent[];
  clearAll: () => void;
}

export function useAgentProgress(sessionId: string | undefined): UseAgentProgressResult {
  const [active, setActive] = useState<Map<string, ActiveAgent>>(new Map());
  // Tracks run sessionIds for which a `done` arrived. A late `working` from a
  // finished run — a straggler racing the terminal `done` across the multi-hop
  // async chain (claw → claw-auth → spaces → redis) — carries that done sessionId
  // and is dropped forever; a brand-new run has a fresh sessionId and is shown
  // immediately. Deterministic: no timers, and never blocks an immediate re-run.
  const doneSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;

    doneSessionsRef.current = new Set();

    // Rehydrate from the server-side Redis hash on mount so reopening the thread
    // mid-run still shows the spinner (pub/sub doesn't replay past events).
    let aborted = false;
    void apiInstance
      .get<{
        data?: Array<{
          agentSlug?: string | null;
          agentName?: string | null;
          agentUserId?: string | null;
          sessionId?: string | null;
          toolLabel?: string | null;
          conversationId?: string;
          triggeredByUserId?: string | null;
        }>;
      }>(`/conversations/${encodeURIComponent(sessionId)}/agent-progress`)
      .then(res => {
        if (aborted) return;
        const entries = res.data.data ?? [];
        if (entries.length === 0) return;
        setActive(prev => {
          const next = new Map(prev);
          for (const d of entries) {
            if (d.conversationId && d.conversationId !== sessionId) continue;
            const key = d.agentUserId ?? d.agentSlug ?? 'unknown';
            if (next.has(key)) continue; // live socket event already placed it
            if (d.sessionId && doneSessionsRef.current.has(d.sessionId)) continue; // its run already ended live — don't resurrect
            next.set(key, {
              agentSlug: d.agentSlug ?? null,
              agentName: d.agentName ?? d.agentSlug ?? null,
              agentUserId: d.agentUserId ?? null,
              toolLabel: d.toolLabel ?? null,
              triggeredByUserId: d.triggeredByUserId ?? null,
              variant: pickRandomAgentSpinnerVariant(),
              at: Date.now(),
            });
          }
          return next;
        });
      })
      .catch(() => {
        /* non-fatal — socket events will populate live state */
      });

    const handler = (evt: SessionActivityEvent): void => {
      logger.info(LogEvent.INFO, {
        type: 'migrated_console_info',
        message: String('Received session_activity event'),
        context: [evt],
      });
      if (evt?.message?.msgType !== MessageType.SYSTEM) return;
      let parsed: AgentProgressData | undefined;
      try {
        parsed = JSON.parse(evt.message.content) as AgentProgressData;
      } catch {
        return;
      }
      if (parsed?.type !== 'agent_progress') return;
      const d = parsed.data ?? {};

      // Scope the spinner to the thread (conversationId) only — not the channel input.
      if (!d.conversationId || d.conversationId !== sessionId) return;

      const key = d.agentUserId ?? d.agentSlug ?? 'unknown';

      setActive(prev => {
        const next = new Map(prev);
        if (d.status === 'done') {
          if (d.sessionId) doneSessionsRef.current.add(d.sessionId);
          next.delete(key);
          return next;
        }
        // Drop a `working` straggler from a run that already emitted `done`.
        // Keyed by run id (sessionId), so this never blocks a fresh re-run.
        if (d.sessionId && doneSessionsRef.current.has(d.sessionId)) return prev;
        const existing = prev.get(key);
        const nextLabel = d.toolLabel ?? null;
        // Roll a new spinner variant only when the label actually changes, so a
        // heartbeat of the same label doesn't flicker the icon mid-frame.
        const variant =
          existing && existing.toolLabel === nextLabel
            ? existing.variant
            : pickRandomAgentSpinnerVariant(existing?.variant);
        next.set(key, {
          agentSlug: d.agentSlug ?? null,
          agentName: d.agentName ?? d.agentSlug ?? null,
          agentUserId: d.agentUserId ?? null,
          toolLabel: nextLabel,
          // Tool-label updates may omit the triggerer; keep the first value seen.
          triggeredByUserId: d.triggeredByUserId ?? existing?.triggeredByUserId ?? null,
          variant,
          at: Date.now(),
        });
        return next;
      });
    };

    websocketService.on('session_activity', handler);
    return (): void => {
      aborted = true;
      websocketService.removeListener('session_activity', handler);
      setActive(new Map());
    };
  }, [sessionId]);

  // Auto-expire stale entries + server-verify backstop.
  //
  // Two roles:
  //   1. Local stale-entry sweep: drop entries we haven't heard a heartbeat from
  //      in STALE_MS (crash-safety for runs that never emit done).
  //   2. Server-verify (every ~5s while active): re-check the GET endpoint and
  //      clear the local map if the server says no agents are running. This catches
  //      the race where the WebSocket done event was emitted during the hook's
  //      sessionId-transition window (cleanup → new mount) and was therefore missed.
  //      The GET now filters tombstoned entries server-side, so an empty response is
  //      authoritative proof that the run is over.
  useEffect(() => {
    if (active.size === 0 || !sessionId) return;
    // Server-verify: poll every 5 s while the spinner is active.
    const verifyId = setInterval(() => {
      void apiInstance
        .get<{ data?: unknown[] }>(`/conversations/${encodeURIComponent(sessionId)}/agent-progress`)
        .then(res => {
          if ((res.data.data ?? []).length === 0) setActive(new Map());
        })
        .catch(() => {
          /* non-fatal */
        });
    }, 5_000);
    // Local stale-entry sweep: run every 30 s.
    const staleId = setInterval(() => {
      setActive(prev => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of prev) {
          if (now - v.at > STALE_MS) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30_000);
    return (): void => {
      clearInterval(verifyId);
      clearInterval(staleId);
    };
  }, [active.size, sessionId]);

  // When another AgentProgressIndicator instance (e.g. channel input vs thread input)
  // successfully aborts the same conversationId, it dispatches this custom event so
  // all sibling instances clear their state immediately without waiting for the socket.
  useEffect(() => {
    if (!sessionId) return;
    const handle = (evt: Event): void => {
      const { conversationId: clearedId } = (evt as CustomEvent<{ conversationId: string }>).detail;
      if (clearedId === sessionId) setActive(new Map());
    };
    window.addEventListener('agent-progress-cleared', handle);
    return (): void => window.removeEventListener('agent-progress-cleared', handle);
  }, [sessionId]);

  const clearAll = (): void => setActive(new Map());

  return { agents: Array.from(active.values()), clearAll };
}
