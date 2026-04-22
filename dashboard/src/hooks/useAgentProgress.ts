import { useEffect, useRef, useState } from 'react';
import { websocketService } from '../services/clients/socketClient';
import {
  pickRandomAgentSpinnerVariant,
  type AgentSpinnerVariant,
} from '../components/ui/AgentSpinner';
import { apiInstance } from '../services/clients/apiClient';

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
  agentUserId: string | null;
  toolLabel: string | null;
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
    agentUserId?: string | null;
    toolLabel?: string | null;
    status?: 'working' | 'done';
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
    msgType: string;
    createdAt: Date;
  };
}

export function useAgentProgress(sessionId: string | undefined): ActiveAgent[] {
  const [active, setActive] = useState<Map<string, ActiveAgent>>(new Map());
  // Tracks agent-keys for which a `done` arrived, so a late-arriving rehydrate
  // response can't resurrect them (race: live event fires while rehydrate is in flight).
  const doneKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;

    doneKeysRef.current = new Set();

    // Rehydrate from the server-side Redis hash on mount so reopening the thread
    // mid-run still shows the spinner (pub/sub doesn't replay past events).
    let aborted = false;
    void apiInstance
      .get<{
        data?: Array<{
          agentSlug?: string | null;
          agentUserId?: string | null;
          toolLabel?: string | null;
          conversationId?: string;
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
            if (doneKeysRef.current.has(key)) continue; // `done` already arrived live — don't resurrect
            next.set(key, {
              agentSlug: d.agentSlug ?? null,
              agentUserId: d.agentUserId ?? null,
              toolLabel: d.toolLabel ?? null,
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
      console.info('Received session_activity event', evt);
      if (evt?.message?.msgType !== 'SYSTEM') return;
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
          doneKeysRef.current.add(key);
          next.delete(key);
          return next;
        }
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
          agentUserId: d.agentUserId ?? null,
          toolLabel: nextLabel,
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

  // Auto-expire stale entries.
  useEffect(() => {
    if (active.size === 0) return;
    const id = setInterval(() => {
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
    return (): void => clearInterval(id);
  }, [active.size]);

  return Array.from(active.values());
}
