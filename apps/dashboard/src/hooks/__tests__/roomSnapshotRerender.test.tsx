/**
 * Area 1 proof: whole-snapshot `useSelector(roomActor, s => s)` in useCallJoinOrInitiate
 * re-renders EVERY mounted consumer (CallLinkPreview / ScheduledCallPill live inside message
 * bubbles) on every roomActor snapshot change, even when the values the consumer actually
 * uses (isInCall, joinCall) did not change.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
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

vi.mock('../useZero', () => ({ useZero: () => ({ mutate: {} }) }));
vi.mock('../usePlatform', async importOriginal => ({ ...(await importOriginal<object>()), usePlatform: () => ({ isMobile: false }) }));

const N = 50; // e.g. a channel scrolled to 50 call-link / scheduled-call bubbles
let renders = 0;
let narrowRenders = 0;

let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let roomActor: typeof import('../../machines/roomMachine').roomActor;
let useCallJoinOrInitiate: typeof import('../useCallJoinOrInitiate').useCallJoinOrInitiate;
let useSelector: typeof import('@xstate/react').useSelector;

beforeAll(async () => {
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ roomActor } = await import('../../machines/roomMachine'));
  ({ useCallJoinOrInitiate } = await import('../useCallJoinOrInitiate'));
  ({ useSelector } = await import('@xstate/react'));
});

function RealConsumer(): null {
  // what CallLinkPreview.tsx:163 does
  const { isInCall } = useCallJoinOrInitiate();
  void isInCall;
  renders++;
  return null;
}

function NarrowConsumer(): null {
  // the fix shape: select only what is consumed
  const isInCall = useSelector(roomActor, s =>
    s.matches('initiating') || s.matches('joining') || s.matches('connecting') || s.matches('connected'),
  );
  void isInCall;
  narrowRenders++;
  return null;
}

describe('roomActor whole-snapshot selector re-render fan-out', () => {
  it('re-renders all N bubbles on snapshot changes that do not change isInCall', async () => {
    const root = createRoot(document.getElementById('root')!);
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          ...Array.from({ length: N }, (_, i) => React.createElement(RealConsumer, { key: 'r' + i })),
          ...Array.from({ length: N }, (_, i) => React.createElement(NarrowConsumer, { key: 'n' + i })),
        ),
      );
    });
    const state0 = JSON.stringify(roomActor.getSnapshot().value);
    expect(renders).toBe(N);
    expect(narrowRenders).toBe(N);
    renders = 0;
    narrowRenders = 0;

    const UPDATES = 20;
    // GlobalCallOverlay.tsx:28-32 re-sends UPDATE_ACTIVE_CALLS with a fresh array every time the
    // userActiveCalls Zero query emits (any change to any active call row the user can see).
    for (let i = 0; i < UPDATES; i++) {
      await act(async () => {
        roomActor.send({ type: 'UPDATE_ACTIVE_CALLS', calls: [] } as never);
      });
    }
    const afterActiveCalls = { real: renders, narrow: narrowRenders };
    renders = 0;
    narrowRenders = 0;

    // An event the idle state does not handle at all
    for (let i = 0; i < UPDATES; i++) {
      await act(async () => {
        roomActor.send({ type: 'TOGGLE_MIC' } as never);
      });
    }
    const afterUnhandled = { real: renders, narrow: narrowRenders };

    console.log(
      `ROOM-RERENDER N=${N} updates=${UPDATES} state=${state0} ` +
        `UPDATE_ACTIVE_CALLS(empty->empty): whole-snapshot=${afterActiveCalls.real} narrow=${afterActiveCalls.narrow} | ` +
        `unhandled TOGGLE_MIC: whole-snapshot=${afterUnhandled.real} narrow=${afterUnhandled.narrow}`,
    );
    expect(JSON.stringify(roomActor.getSnapshot().value)).toBe(state0); // isInCall never changed
    expect(afterActiveCalls.narrow).toBe(0);
    // The assertion that SHOULD hold for a component whose inputs did not change:
    expect(afterActiveCalls.real).toBe(0);
  });
});
