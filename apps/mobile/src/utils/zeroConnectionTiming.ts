import type { Zero } from '@rocicorp/zero';

type ConnectionEvent = {
  stateName: string;
  timestamp: number;
};

const events: ConnectionEvent[] = [];
const MAX_EVENTS = 200;

function recordStateChange(stateName: string): void {
  const timestamp = performance.now();
  const last = events[events.length - 1];
  if (last && last.stateName === stateName) return;

  events.push({ stateName, timestamp });
  if (events.length > MAX_EVENTS) {
    events.shift();
  }
}

function getStateAtOrBefore(timestamp: number): string | undefined {
  let state: string | undefined;
  for (const event of events) {
    if (event.timestamp > timestamp) break;
    state = event.stateName;
  }
  return state;
}

export function trackZeroConnectionDuration(zero: Zero): () => void {
  clearZeroConnectionEvents();
  recordStateChange(zero.connection.state.current.name);
  return zero.connection.state.subscribe(state => {
    recordStateChange(state.name);
  });
}

export function getConnectionDurationDuring(startMs: number, endMs: number): number | undefined {
  if (events.length === 0 || startMs > endMs) return undefined;

  const stateAtStart = getStateAtOrBefore(startMs);
  if (stateAtStart === 'connected') return 0;

  let connectingTimestamp: number | undefined = stateAtStart === 'connecting' ? startMs : undefined;
  let connectedTimestamp: number | undefined;

  for (const event of events) {
    if (event.timestamp < startMs) continue;
    if (event.timestamp > endMs) break;

    if (event.stateName === 'connecting' && connectingTimestamp === undefined) {
      connectingTimestamp = event.timestamp;
    }

    if (
      connectingTimestamp !== undefined &&
      event.stateName === 'connected' &&
      connectedTimestamp === undefined
    ) {
      connectedTimestamp = event.timestamp;
      break;
    }
  }

  if (connectingTimestamp === undefined) return undefined;

  const windowedStart = Math.max(connectingTimestamp, startMs);
  if (connectedTimestamp === undefined) {
    return Math.max(0, Math.round(endMs - windowedStart));
  }

  return Math.max(0, Math.round(connectedTimestamp - windowedStart));
}

export function clearZeroConnectionEvents(): void {
  events.length = 0;
}
