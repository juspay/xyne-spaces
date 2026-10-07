/**
 * Area 1i proof: the four remaining whole-snapshot roomActor/callActor subscribers
 * (useCallHistory, IncomingCallModal, CustomLiveKitRoom, ElectronUpdateNudge) were
 * narrowed to boolean matches-selectors / per-field context selectors on this branch.
 *
 * This test replicates, against the REAL roomActor, the exact selector shapes now in
 * production and demonstrates the calibration: a whole-snapshot consumer re-renders on
 * EVERY handled context assign (what the four sites did before this branch), while each
 * narrow shape used by the fix renders 0 times when its inputs did not change.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from '/workspace/xyne-spaces/node_modules/.pnpm/jsdom@28.1.0_@noble+hashes@2.2.0/node_modules/jsdom/lib/api.js';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Element', 'HTMLMediaElement', 'Event', 'CustomEvent']) {
  try { if (!(k in g) || k === 'window' || k === 'document') g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* readonly */ }
}
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (k in g) continue;
  try { g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* skip */ }
}
g.IS_REACT_ACT_ENVIRONMENT = true;
g.__APP_VERSION__ = 'test';

const N = 50; // e.g. 50 mounted consumers of the room actor
let wholeRenders = 0;
let boolRenders = 0;
let fieldRenders = 0;
let machineStateRenders = 0;

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let roomActor: typeof import('../../machines/roomMachine').roomActor;
let useSelector: typeof import('@xstate/react').useSelector;

beforeAll(async () => {
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ roomActor } = await import('../../machines/roomMachine'));
  ({ useSelector } = await import('@xstate/react'));
});

// The shape the four sites had before this branch (useSelector(roomActor, s => s)).
function WholeConsumer(): null {
  const snapshot = useSelector(roomActor, s => s);
  void snapshot;
  wholeRenders++;
  return null;
}

// The boolean matches-chain shape now used by useCallHistory / IncomingCallModal /
// ElectronUpdateNudge (isInCall / isInActiveCall / isRoomBusy).
function BoolConsumer(): null {
  const isInCall = useSelector(
    roomActor,
    s =>
      s.matches('initiating') ||
      s.matches('joining') ||
      s.matches('connecting') ||
      s.matches('connected'),
  );
  void isInCall;
  boolRenders++;
  return null;
}

// The per-field context shape now used by CustomLiveKitRoom (25 such selectors; channelId
// is representative — a stable primitive the room view reads but active-calls churn
// must not disturb).
function FieldConsumer(): null {
  const channelId = useSelector(roomActor, s => s.context.channelId);
  void channelId;
  fieldRenders++;
  return null;
}

// CustomLiveKitRoom's machineState primitive selector (matches-chain -> string).
function MachineStateConsumer(): null {
  const machineState = useSelector(
    roomActor,
    s =>
      s.matches('connected')
        ? 'connected'
        : s.matches('connecting')
          ? 'connecting'
          : s.matches('initiating')
            ? 'initiating'
            : s.matches('joining')
              ? 'joining'
              : s.matches('disconnecting')
                ? 'disconnecting'
                : 'idle',
  );
  void machineState;
  machineStateRenders++;
  return null;
}

describe('roomActor narrow-selector re-render isolation (Area 1i sites)', () => {
  it('whole-snapshot consumer re-renders on every UPDATE_ACTIVE_CALLS; the shipped narrow shapes do not', async () => {
    const root = createRoot(document.getElementById('root')!);
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          ...Array.from({ length: N }, (_, i) => React.createElement(WholeConsumer, { key: 'w' + i })),
          ...Array.from({ length: N }, (_, i) => React.createElement(BoolConsumer, { key: 'b' + i })),
          ...Array.from({ length: N }, (_, i) => React.createElement(FieldConsumer, { key: 'f' + i })),
          ...Array.from({ length: N }, (_, i) => React.createElement(MachineStateConsumer, { key: 'm' + i })),
        ),
      );
    });
    const state0 = JSON.stringify(roomActor.getSnapshot().value);
    expect(wholeRenders).toBe(N);
    // Reset: from here on we count only re-renders caused by the events below
    // (each consumer rendered exactly once on mount).
    wholeRenders = 0;
    boolRenders = 0;
    fieldRenders = 0;
    machineStateRenders = 0;

    const UPDATES = 20;
    // GlobalCallOverlay.tsx re-sends UPDATE_ACTIVE_CALLS with a fresh array every time the
    // userActiveCalls Zero query emits — the churn the four sites used to re-render to.
    for (let i = 0; i < UPDATES; i++) {
      await act(async () => {
        roomActor.send({ type: 'UPDATE_ACTIVE_CALLS', calls: [] } as never);
      });
    }
    const afterActiveCalls = {
      whole: wholeRenders,
      bool: boolRenders,
      field: fieldRenders,
      machineState: machineStateRenders,
    };
    wholeRenders = 0;
    boolRenders = 0;
    fieldRenders = 0;
    machineStateRenders = 0;

    // An event the idle state does not handle at all.
    for (let i = 0; i < UPDATES; i++) {
      await act(async () => {
        roomActor.send({ type: 'TOGGLE_MIC' } as never);
      });
    }
    const afterUnhandled = {
      whole: wholeRenders,
      bool: boolRenders,
      field: fieldRenders,
      machineState: machineStateRenders,
    };

    console.log(
      `ROOM-NARROW N=${N} updates=${UPDATES} state=${state0} ` +
        `UPDATE_ACTIVE_CALLS(empty->empty): whole=${afterActiveCalls.whole} bool=${afterActiveCalls.bool} ` +
        `field=${afterActiveCalls.field} machineState=${afterActiveCalls.machineState} | ` +
        `unhandled TOGGLE_MIC: whole=${afterUnhandled.whole} bool=${afterUnhandled.bool} ` +
        `field=${afterUnhandled.field} machineState=${afterUnhandled.machineState}`,
    );
    expect(JSON.stringify(roomActor.getSnapshot().value)).toBe(state0); // isInCall never changed
    // The control: whole-snapshot fan-out is exactly what the four sites did before.
    expect(afterActiveCalls.whole).toBe(UPDATES * N); // control: 20 wasted re-renders per whole-snapshot consumer
    // The fix property: the shipped selector shapes stay silent when their inputs do not change.
    expect(afterActiveCalls.bool).toBe(0);
    expect(afterActiveCalls.field).toBe(0);
    expect(afterActiveCalls.machineState).toBe(0);
    expect(afterUnhandled.whole).toBe(0);
    expect(afterUnhandled.bool).toBe(0);
    expect(afterUnhandled.field).toBe(0);
    expect(afterUnhandled.machineState).toBe(0);
  });
});
