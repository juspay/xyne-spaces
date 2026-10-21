/**
 * User-facing copy for the Zero live-sync connection, keyed by the state names
 * Zero reports (`useConnectionState().name`). Pure data so the L1 tests can
 * assert every state has an explanation and the header/sheet stay in step.
 *
 * "Zero" is the sync engine's name. Users see it as "Live sync"; the engine name
 * appears once in the explainer so a support conversation can connect the two.
 */

export type ZeroConnectionName =
  'connected' | 'connecting' | 'disconnected' | 'needs-auth' | 'error' | 'closed';

export type ConnectionTone = 'good' | 'busy' | 'bad' | 'neutral';

export interface ConnectionStateCopy {
  name: ZeroConnectionName | 'unknown';
  /** Short label for the header and the status pill. */
  label: string;
  tone: ConnectionTone;
  /** Indicator colour. Mirrors the dashboard's ZeroConnectionStatus. */
  dotColor: string;
  /** One sentence: what this state means for the user right now. */
  meaning: string;
  /** One sentence: what, if anything, the user should do. */
  whatToDo: string;
  /** Whether "Refresh connection" is a sensible action in this state. */
  canRefresh: boolean;
}

export const CONNECTION_TONE_COLOR: Readonly<Record<ConnectionTone, string>> = {
  good: '#00C851',
  busy: '#FFD600',
  bad: '#FF5252',
  neutral: '#9E9E9E',
};

const copy = (
  name: ConnectionStateCopy['name'],
  label: string,
  tone: ConnectionTone,
  meaning: string,
  whatToDo: string,
  canRefresh: boolean,
): ConnectionStateCopy => ({
  name,
  label,
  tone,
  dotColor: CONNECTION_TONE_COLOR[tone],
  meaning,
  whatToDo,
  canRefresh,
});

const STATE_ENTRIES: readonly ConnectionStateCopy[] = [
  copy('connected', 'Connected', 'good', 'Everything is up to date.', 'Nothing to do.', false),
  copy(
    'connecting',
    'Connecting',
    'busy',
    'Connecting to your workspace.',
    'Keep going. Messages you send go out once connected.',
    false,
  ),
  copy(
    'disconnected',
    'Disconnected',
    'bad',
    'No live connection. Nothing new will arrive.',
    'Check your network, then tap Refresh.',
    true,
  ),
  copy(
    'needs-auth',
    'Signing in again',
    'busy',
    'Your session is being renewed.',
    'Wait a moment. If it stays here, sign out and back in.',
    true,
  ),
  copy(
    'error',
    'Error',
    'bad',
    'The connection failed.',
    'Tap Refresh. Still failing? Sign out and back in.',
    true,
  ),
  copy(
    'closed',
    'Closed',
    'neutral',
    'The connection was closed, usually while switching workspace.',
    'It reopens on its own. If not, tap Refresh.',
    true,
  ),
];

export const CONNECTION_STATE_COPY: Readonly<Record<ZeroConnectionName, ConnectionStateCopy>> =
  Object.fromEntries(STATE_ENTRIES.map(entry => [entry.name, entry])) as Record<
    ZeroConnectionName,
    ConnectionStateCopy
  >;

const UNKNOWN_STATE: ConnectionStateCopy = copy(
  'unknown',
  'Unknown',
  'neutral',
  'Connection state unknown.',
  'Tap Refresh, or reopen the app.',
  true,
);

export function isZeroConnectionName(name: string): name is ZeroConnectionName {
  return Object.prototype.hasOwnProperty.call(CONNECTION_STATE_COPY, name);
}

/** Copy for a state name, with a safe fallback for anything Zero adds later. */
export function describeConnectionState(name: string): ConnectionStateCopy {
  return isZeroConnectionName(name) ? CONNECTION_STATE_COPY[name] : UNKNOWN_STATE;
}

/** Order the states are listed in the sheet's "How live sync works" section. */
export const CONNECTION_STATE_ORDER: readonly ZeroConnectionName[] = [
  'connected',
  'connecting',
  'disconnected',
  'needs-auth',
  'error',
  'closed',
];

export const LIVE_SYNC_TITLE = 'Live sync';

export const LIVE_SYNC_EXPLAINER =
  'Xyne Spaces keeps a live connection (Zero) to your workspace, so messages, calls and tickets update instantly. The dot shows its state.';

/** Guide the sheet links to for the longer explanation. */
export const LIVE_SYNC_GUIDE_ID = 'sync-status';
