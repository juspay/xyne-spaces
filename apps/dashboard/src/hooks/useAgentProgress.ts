import { useCallback, useSyncExternalStore } from 'react';
import { logger, Event as LogEvent } from '../utils/logger';
import { websocketService } from '../services/clients/socketClient';
import {
  pickRandomAgentSpinnerVariant,
  type AgentSpinnerVariant,
} from '../components/ui/AgentSpinner';
import { MessageType } from '@xyne/shared';

/**
 * Ephemeral agent-progress state ("agent is working" pill, plan-card gating) —
 * one shared entry per conversation, read through useAgentProgress below.
 *
 * Every consumer (the chat-input pill, each plan card) reads the same entry, so a
 * conversation costs one socket listener and one sync no matter how many components
 * render it (XYNE-65672: per-component GET + 5 s polling reached ~500 rpm).
 *
 * Live updates: WebSocket session_activity events, same transport as typing.
 *   xyne-claw-auth → spaces /api/apps/chat/agentProgress →
 *   redisService.broadcastMessageToSession(channelId, SYSTEM event).
 * Current state: `agent_progress_sync { conversationIds }` → `agent_progress_snapshot`.
 *   Pub/sub doesn't replay past events, so the store asks for the current state at
 *   every point it may have missed some: when a conversation is first watched, after
 *   each (re)connect and subscribe ack, and when the tab becomes visible again. The
 *   server also pushes a snapshot after its own Redis subscriber reconnects.
 *   A snapshot is the latest state only — one entry per agent running now.
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

interface ProgressData {
  conversationId?: string;
  agentSlug?: string | null;
  agentName?: string | null;
  agentUserId?: string | null;
  /** Run id. Scopes done-suppression so a straggler from a finished run can't resurrect the spinner. */
  sessionId?: string | null;
  toolLabel?: string | null;
  status?: 'working' | 'done';
  triggeredByUserId?: string | null;
}

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

interface AgentProgressSnapshotEvent {
  entries?: Record<string, ProgressData[]>;
}

// Drop entries we haven't heard from in this long (ms). Real agent runs can have
// individual tool calls lasting several minutes (RAG, LLM calls, DB scans), so the
// stale window is a crash-safety backstop, not a per-tool budget. The `status: 'done'`
// signal from claw-auth clears the spinner immediately when an agent actually finishes.
const STALE_MS = 10 * 60 * 1000;
const STALE_SWEEP_MS = 30_000;
// Keep an unwatched conversation briefly, so a remount (list virtualization, thread
// switch, StrictMode) reuses it instead of re-syncing.
const RELEASE_DELAY_MS = 5_000;
// A snapshot is read on the server a moment before it arrives. An agent that a live
// event added within this window may be missing from it only because it started after
// the read — keep it rather than flicker it off.
const SNAPSHOT_RACE_MS = 2_000;
// Server-side cap per agent_progress_sync request.
const SYNC_BATCH_SIZE = 100;

interface ConversationEntry {
  agents: Map<string, ActiveAgent>;
  /** Last live (socket) update per agent key — see SNAPSHOT_RACE_MS. */
  liveAt: Map<string, number>;
  /**
   * Run sessionIds for which a `done` arrived. A late `working` from a finished run —
   * a straggler racing the terminal `done` across the multi-hop async chain
   * (claw → claw-auth → spaces → redis) — carries that done sessionId and is dropped
   * forever; a brand-new run has a fresh sessionId and is shown immediately.
   */
  doneSessions: Set<string>;
  /** Stable array handed to React; replaced only when agents change. */
  view: ActiveAgent[];
  listeners: Set<() => void>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const EMPTY: ActiveAgent[] = [];
const entries = new Map<string, ConversationEntry>();
const pendingSync = new Set<string>();
let syncScheduled = false;
let staleTimer: ReturnType<typeof setInterval> | null = null;
let socketHandlersAttached = false;

const agentKey = (d: ProgressData): string => d.agentUserId ?? d.agentSlug ?? 'unknown';

function publish(entry: ConversationEntry): void {
  entry.view = entry.agents.size === 0 ? EMPTY : Array.from(entry.agents.values());
  for (const listener of entry.listeners) listener();
}

function toAgent(d: ProgressData, existing: ActiveAgent | undefined, now: number): ActiveAgent {
  const nextLabel = d.toolLabel ?? null;
  // Roll a new spinner variant only when the label actually changes, so a
  // heartbeat of the same label doesn't flicker the icon mid-frame.
  const variant =
    existing && existing.toolLabel === nextLabel
      ? existing.variant
      : pickRandomAgentSpinnerVariant(existing?.variant);
  return {
    agentSlug: d.agentSlug ?? null,
    agentName: d.agentName ?? d.agentSlug ?? null,
    agentUserId: d.agentUserId ?? null,
    toolLabel: nextLabel,
    // Tool-label updates may omit the triggerer; keep the first value seen.
    triggeredByUserId: d.triggeredByUserId ?? existing?.triggeredByUserId ?? null,
    variant,
    at: now,
  };
}

// ── Live events ─────────────────────────────────────────────────────────────

function handleSessionActivity(evt: SessionActivityEvent): void {
  logger.info(LogEvent.INFO, {
    type: 'migrated_console_info',
    message: String('Received session_activity event'),
    context: [evt],
  });
  if (evt?.message?.msgType !== MessageType.SYSTEM) return;
  let parsed: { type?: string; data?: ProgressData } | undefined;
  try {
    parsed = JSON.parse(evt.message.content) as { type?: string; data?: ProgressData };
  } catch {
    return;
  }
  if (parsed?.type !== 'agent_progress') return;
  const d = parsed.data ?? {};

  // Scoped to the thread (conversationId) — only conversations someone is watching.
  if (!d.conversationId) return;
  const entry = entries.get(d.conversationId);
  if (!entry) return;

  const key = agentKey(d);
  if (d.status === 'done') {
    if (d.sessionId) entry.doneSessions.add(d.sessionId);
    entry.liveAt.delete(key);
    if (entry.agents.delete(key)) publish(entry);
    return;
  }
  // Drop a `working` straggler from a run that already emitted `done`.
  // Keyed by run id (sessionId), so this never blocks a fresh re-run.
  if (d.sessionId && entry.doneSessions.has(d.sessionId)) return;
  const now = Date.now();
  entry.agents.set(key, toAgent(d, entry.agents.get(key), now));
  entry.liveAt.set(key, now);
  publish(entry);
}

// ── Snapshots ───────────────────────────────────────────────────────────────

function applySnapshot(conversationId: string, list: ProgressData[]): void {
  const entry = entries.get(conversationId);
  if (!entry) return;
  const now = Date.now();
  const next = new Map<string, ActiveAgent>();
  for (const d of list) {
    if (d.conversationId && d.conversationId !== conversationId) continue;
    // Its run already ended live — don't resurrect.
    if (d.sessionId && entry.doneSessions.has(d.sessionId)) continue;
    const key = agentKey(d);
    next.set(key, toAgent(d, entry.agents.get(key), now));
  }
  // The snapshot is authoritative for everything else: an agent missing from it has
  // finished, even if this tab never received its `done`.
  for (const [key, agent] of entry.agents) {
    if (!next.has(key) && now - (entry.liveAt.get(key) ?? 0) < SNAPSHOT_RACE_MS)
      next.set(key, agent);
  }
  entry.agents = next;
  publish(entry);
}

function handleSnapshot(evt: AgentProgressSnapshotEvent): void {
  for (const [conversationId, list] of Object.entries(evt?.entries ?? {})) {
    applySnapshot(conversationId, Array.isArray(list) ? list : []);
  }
}

function requestSync(conversationIds: Iterable<string>): void {
  for (const id of conversationIds) pendingSync.add(id);
  if (syncScheduled || pendingSync.size === 0) return;
  syncScheduled = true;
  // Batch everything requested in the same tick (e.g. a list of plan cards mounting).
  setTimeout(() => {
    syncScheduled = false;
    // Not connected: nothing to do now — the next connect re-syncs every entry.
    if (!websocketService.isConnectedToServer()) {
      pendingSync.clear();
      return;
    }
    const ids = [...pendingSync].filter(id => entries.has(id));
    pendingSync.clear();
    for (let i = 0; i < ids.length; i += SYNC_BATCH_SIZE) {
      websocketService.emit('agent_progress_sync', {
        conversationIds: ids.slice(i, i + SYNC_BATCH_SIZE),
      });
    }
  }, 0);
}

const syncAll = (): void => requestSync(entries.keys());

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') syncAll();
}

function attachSocketHandlers(): void {
  if (socketHandlersAttached) return;
  socketHandlersAttached = true;
  const attach = (): void => {
    websocketService.on('session_activity', handleSessionActivity);
    websocketService.on('agent_progress_snapshot', handleSnapshot);
    // Re-sync on (re)connect, and again once the channel subscription is acknowledged:
    // only after that ack are live events guaranteed to reach this socket, so a snapshot
    // taken then cannot leave a gap behind it.
    websocketService.on('connect', syncAll);
    websocketService.on('subscriptions_updated', syncAll);
  };
  // websocketService.on() drops listeners while no socket exists, so wait for the first
  // one like the other socket features do. Never connect() over an existing socket: that
  // replaces it, and every feature's listeners with it.
  if (websocketService.getSocket()) {
    attach();
  } else {
    void websocketService
      .connect()
      .then(() => {
        attach();
        syncAll(); // connected before our 'connect' listener existed
      })
      .catch(() => {
        socketHandlersAttached = false; // retried by the next watcher
      });
  }
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

// ── Stale sweep ─────────────────────────────────────────────────────────────

function sweepStale(): void {
  const now = Date.now();
  for (const entry of entries.values()) {
    let changed = false;
    for (const [key, agent] of entry.agents) {
      if (now - agent.at > STALE_MS) {
        entry.agents.delete(key);
        changed = true;
      }
    }
    if (changed) publish(entry);
  }
}

function syncStaleTimer(): void {
  if (entries.size > 0 && staleTimer === null) staleTimer = setInterval(sweepStale, STALE_SWEEP_MS);
  if (entries.size === 0 && staleTimer !== null) {
    clearInterval(staleTimer);
    staleTimer = null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Watch a conversation. Returns the unsubscribe function (useSyncExternalStore contract). */
export function subscribeAgentProgress(conversationId: string, onChange: () => void): () => void {
  attachSocketHandlers();
  let entry = entries.get(conversationId);
  if (!entry) {
    entry = {
      agents: new Map(),
      liveAt: new Map(),
      doneSessions: new Set(),
      view: EMPTY,
      listeners: new Set(),
      releaseTimer: null,
    };
    entries.set(conversationId, entry);
    syncStaleTimer();
    requestSync([conversationId]);
  }
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.listeners.add(onChange);

  const watched = entry;
  return (): void => {
    watched.listeners.delete(onChange);
    if (watched.listeners.size > 0 || watched.releaseTimer !== null) return;
    watched.releaseTimer = setTimeout(() => {
      watched.releaseTimer = null;
      if (watched.listeners.size === 0 && entries.get(conversationId) === watched) {
        entries.delete(conversationId);
        syncStaleTimer();
      }
    }, RELEASE_DELAY_MS);
  };
}

export function getAgentProgress(conversationId: string): ActiveAgent[] {
  return entries.get(conversationId)?.view ?? EMPTY;
}

/** Clear a conversation's agents for every consumer (e.g. after a confirmed cancel). */
export function clearAgentProgress(conversationId: string): void {
  const entry = entries.get(conversationId);
  if (!entry || entry.agents.size === 0) return;
  entry.agents.clear();
  entry.liveAt.clear();
  publish(entry);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseAgentProgressResult {
  agents: ActiveAgent[];
  clearAll: () => void;
}

const noopUnsubscribe = (): void => {};

export function useAgentProgress(sessionId: string | undefined): UseAgentProgressResult {
  const subscribe = useCallback(
    (onChange: () => void) =>
      sessionId ? subscribeAgentProgress(sessionId, onChange) : noopUnsubscribe,
    [sessionId],
  );
  const getSnapshot = useCallback(
    () => (sessionId ? getAgentProgress(sessionId) : EMPTY),
    [sessionId],
  );
  const agents = useSyncExternalStore(subscribe, getSnapshot);

  const clearAll = useCallback((): void => {
    if (sessionId) clearAgentProgress(sessionId);
  }, [sessionId]);

  return { agents, clearAll };
}
