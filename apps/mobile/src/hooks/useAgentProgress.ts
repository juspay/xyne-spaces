import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { MessageType } from '@xyne/shared';

import { apiGet } from '@/src/services/apiClient';
import { websocketService } from '@/src/services/websocketService';

/**
 * Ephemeral agent-progress state (dashboard parity).
 *
 * Transport: claw-auth → Spaces /api/apps/chat/agentProgress →
 * Redis → WebSocket `session_activity` with JSON `{ type: 'agent_progress' }`.
 * Rehydrate: GET /conversations/:id/agent-progress
 */

export type ActiveAgent = {
  agentSlug: string | null;
  agentName: string | null;
  agentUserId: string | null;
  toolLabel: string | null;
  /** Human who started the run — only this user may stop it. */
  triggeredByUserId: string | null;
  at: number;
};

type AgentProgressData = {
  type: 'agent_progress';
  data: {
    conversationId?: string;
    channelId?: string;
    agentSlug?: string | null;
    agentName?: string | null;
    agentUserId?: string | null;
    sessionId?: string | null;
    toolLabel?: string | null;
    status?: 'working' | 'done';
    triggeredByUserId?: string | null;
  };
};

type SessionActivityEvent = {
  sessionId: string;
  message: {
    messageId: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    content: string;
    msgType: MessageType | string;
    createdAt: Date | string;
  };
};

type AgentProgressEntry = {
  agentSlug?: string | null;
  agentName?: string | null;
  agentUserId?: string | null;
  sessionId?: string | null;
  toolLabel?: string | null;
  conversationId?: string;
  triggeredByUserId?: string | null;
};

type AgentProgressResponse = {
  success?: boolean;
  data?: AgentProgressEntry[];
};

const STALE_MS = 10 * 60 * 1000;
export const AGENT_PROGRESS_CLEARED_EVENT = 'agent-progress-cleared';

export type UseAgentProgressResult = {
  agents: ActiveAgent[];
  clearAll: () => void;
};

const isSystemMessage = (msgType: MessageType | string): boolean =>
  msgType === MessageType.SYSTEM || msgType === 'SYSTEM';

export function useAgentProgress(
  sessionId: string | undefined,
  channelId?: string | undefined,
): UseAgentProgressResult {
  const [active, setActive] = useState<Map<string, ActiveAgent>>(new Map());
  const doneSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;

    doneSessionsRef.current = new Set();
    let aborted = false;

    void apiGet<AgentProgressResponse>(
      `/conversations/${encodeURIComponent(sessionId)}/agent-progress`,
    )
      .then(res => {
        if (aborted) return;
        const entries = res.data ?? [];
        if (entries.length === 0) return;
        setActive(prev => {
          const next = new Map(prev);
          for (const entry of entries) {
            if (entry.conversationId && entry.conversationId !== sessionId) continue;
            const key = entry.agentUserId ?? entry.agentSlug ?? 'unknown';
            if (next.has(key)) continue;
            if (entry.sessionId && doneSessionsRef.current.has(entry.sessionId)) continue;
            next.set(key, {
              agentSlug: entry.agentSlug ?? null,
              agentName: entry.agentName ?? entry.agentSlug ?? null,
              agentUserId: entry.agentUserId ?? null,
              toolLabel: entry.toolLabel ?? null,
              triggeredByUserId: entry.triggeredByUserId ?? null,
              at: Date.now(),
            });
          }
          return next;
        });
      })
      .catch(() => {
        /* non-fatal — socket / poll will populate */
      });

    const handler = (evt: SessionActivityEvent): void => {
      if (!isSystemMessage(evt?.message?.msgType)) return;
      let parsed: AgentProgressData | undefined;
      try {
        parsed = JSON.parse(evt.message.content) as AgentProgressData;
      } catch {
        return;
      }
      if (parsed?.type !== 'agent_progress') return;
      const data = parsed.data ?? {};
      if (!data.conversationId || data.conversationId !== sessionId) return;

      const key = data.agentUserId ?? data.agentSlug ?? 'unknown';
      setActive(prev => {
        const next = new Map(prev);
        if (data.status === 'done') {
          if (data.sessionId) doneSessionsRef.current.add(data.sessionId);
          next.delete(key);
          return next;
        }
        if (data.sessionId && doneSessionsRef.current.has(data.sessionId)) return prev;
        const existing = prev.get(key);
        const nextLabel = data.toolLabel ?? null;
        next.set(key, {
          agentSlug: data.agentSlug ?? null,
          agentName: data.agentName ?? data.agentSlug ?? null,
          agentUserId: data.agentUserId ?? null,
          toolLabel: nextLabel,
          triggeredByUserId: data.triggeredByUserId ?? existing?.triggeredByUserId ?? null,
          at: Date.now(),
        });
        return next;
      });
    };

    let subscribed = false;
    const attach = (): void => {
      if (subscribed) return;
      subscribed = true;
      websocketService.on<SessionActivityEvent>('session_activity', handler);
      // Progress is published to the channel session id; subscribe so live ticks arrive.
      const channels = channelId ? [channelId] : [];
      const conversations = [sessionId];
      websocketService.emit('subscribe_to_channels', { channels, conversations });
    };

    if (websocketService.isConnectedToServer()) {
      attach();
    } else {
      void websocketService
        .connect()
        .then(attach)
        .catch(() => undefined);
    }

    return (): void => {
      aborted = true;
      websocketService.removeListener('session_activity', handler);
      setActive(new Map());
    };
  }, [sessionId, channelId]);

  useEffect(() => {
    if (active.size === 0 || !sessionId) return;
    const verifyId = setInterval(() => {
      void apiGet<AgentProgressResponse>(
        `/conversations/${encodeURIComponent(sessionId)}/agent-progress`,
      )
        .then(res => {
          if ((res.data ?? []).length === 0) setActive(new Map());
        })
        .catch(() => undefined);
    }, 5_000);
    const staleId = setInterval(() => {
      setActive(prev => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, value] of prev) {
          if (now - value.at > STALE_MS) {
            next.delete(key);
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

  useEffect(() => {
    if (!sessionId) return;
    const subscription = DeviceEventEmitter.addListener(
      AGENT_PROGRESS_CLEARED_EVENT,
      (detail: { conversationId?: string }) => {
        if (detail?.conversationId === sessionId) setActive(new Map());
      },
    );
    return (): void => subscription.remove();
  }, [sessionId]);

  const clearAll = useCallback((): void => setActive(new Map()), []);

  return { agents: Array.from(active.values()), clearAll };
}
