import type { DebugArtifactBundle, DebugEventRecord } from '../utils/XyneAITypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function eventKey(event: Record<string, unknown>): string {
  const kind = asString(event['kind']);
  const seq = event['seq'];
  if (typeof seq === 'number' || typeof seq === 'string') return `${kind}:${String(seq)}`;
  return [kind, asString(event['toolCallId']), asString(event['at'])].join(':');
}

function mergeEvents(persisted: unknown, live: DebugEventRecord[]): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  if (Array.isArray(persisted)) {
    for (const event of persisted) {
      if (isRecord(event)) merged.set(eventKey(event), event);
    }
  }
  for (const event of live)
    merged.set(
      eventKey(event as unknown as Record<string, unknown>),
      event as unknown as Record<string, unknown>,
    );
  return [...merged.values()].sort((left, right) => {
    const leftAt = Date.parse(asString(left['at']));
    const rightAt = Date.parse(asString(right['at']));
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    const leftSeq = typeof left['seq'] === 'number' ? left['seq'] : Number.NaN;
    const rightSeq = typeof right['seq'] === 'number' ? right['seq'] : Number.NaN;
    return Number.isFinite(leftSeq) && Number.isFinite(rightSeq) ? leftSeq - rightSeq : 0;
  });
}

/**
 * Builds one canonical debugger model while a run is active. Live SSE events
 * enrich their matching persisted run instead of rendering as a second trace.
 */
export function mergeLiveDebugTimeline(
  bundle: DebugArtifactBundle | null,
  liveEvents: DebugEventRecord[],
  conversationId: string,
): DebugArtifactBundle | null {
  if (liveEvents.length === 0) return bundle;

  const sessionStart = liveEvents.find(event => event.kind === 'session_start');
  const sessionId = asString(sessionStart?.data['sessionId']);
  const rootLiveEvents = liveEvents.filter(event => !event.subagentName);
  const base: DebugArtifactBundle = bundle
    ? {
        ...bundle,
        runs: bundle.runs.map(run => ({ ...run, data: { ...run.data } })),
        subagents: bundle.subagents.map(subagent => ({
          ...subagent,
          data: { ...subagent.data },
        })),
      }
    : {
        conversationId,
        debugSession: null,
        debugEvents: null,
        runs: [],
        subagents: [],
      };

  const matchesSession = (data: Record<string, unknown>): boolean =>
    Boolean(sessionId) && asString(data['sessionId']) === sessionId;
  let matchedRoot = false;

  if (base.debugSession && matchesSession(base.debugSession)) {
    base.debugSession = {
      ...base.debugSession,
      events: mergeEvents(base.debugSession['events'], rootLiveEvents),
    };
    matchedRoot = true;
  }
  base.runs = base.runs.map(run => {
    if (!matchesSession(run.data)) return run;
    matchedRoot = true;
    return {
      ...run,
      data: { ...run.data, events: mergeEvents(run.data['events'], rootLiveEvents) },
    };
  });

  if (!matchedRoot) {
    const fallbackSession = base.debugSession;
    const canUseFallback = !sessionId && fallbackSession;
    base.debugSession = {
      ...(canUseFallback ? fallbackSession : {}),
      ...(sessionStart?.data ?? {}),
      ...(sessionId ? { sessionId } : {}),
      startedAt: sessionStart?.at ?? fallbackSession?.['startedAt'] ?? liveEvents[0]?.at,
      task:
        asString(sessionStart?.data['task']) || asString(fallbackSession?.['task']) || 'Live run',
      events: mergeEvents(canUseFallback ? fallbackSession?.['events'] : [], rootLiveEvents),
    };
  }

  const liveSubagents = new Map<string, DebugEventRecord[]>();
  for (const event of liveEvents) {
    if (!event.subagentName) continue;
    const key = `${event.parentToolCallId ?? 'unknown'}:${event.subagentName}`;
    const events = liveSubagents.get(key) ?? [];
    events.push(event);
    liveSubagents.set(key, events);
  }
  for (const [key, events] of liveSubagents) {
    const first = events[0];
    if (!first) continue;
    const existingIndex = base.subagents.findIndex(subagent => {
      const data = subagent.data;
      return (
        asString(data['parentSessionId']) === sessionId &&
        asString(data['parentToolCallId']) === (first.parentToolCallId ?? '') &&
        asString(data['subagentName']) === first.subagentName
      );
    });
    const existing = existingIndex >= 0 ? base.subagents[existingIndex] : undefined;
    const data = {
      ...(existing?.data ?? {}),
      parentSessionId: sessionId,
      parentToolCallId: first.parentToolCallId ?? '',
      subagentName: first.subagentName,
      task: asString(first.data['task']) || asString(first.data['question']) || 'Subagent task',
      events: mergeEvents(existing?.data['events'], events),
    };
    if (existingIndex >= 0) {
      base.subagents[existingIndex] = { ...existing!, data };
    } else {
      base.subagents.push({ fileName: `live-${sessionId || 'run'}-${key}.json`, data });
    }
  }

  return base;
}
