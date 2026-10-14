import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OpenIntent } from '../intent/openIntent.types';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import { OPEN_ACTION_TYPES, type OpenAction } from '../machine/openActions';
import { openReducer } from '../machine/openReducer';
import {
  EMPTY_FACTS,
  IDLE_STATE,
  initFromIntent,
  type DataFacts,
  type LandingTarget,
  type ListMetrics,
  type OpenState,
} from '../machine/openState';
import { isErrorVisible, isSkeletonVisible, isSurfaceVisible } from '../machine/selectors';
import { STAGE_BUDGET_MS } from '../machine/timeouts';

const KEY = 'channel:channel-1';
const OTHER = 'channel:other';

const intent = (over: Partial<OpenIntent> = {}): OpenIntent => ({
  intentKey: KEY,
  surface: { kind: 'channel', channelId: 'channel-1' },
  entry: 'tap',
  isColdStart: false,
  raw: {},
  hint: { channelId: 'channel-1' },
  ...over,
});

const anchored = intent({
  hint: { channelId: 'channel-1', conversationId: 'msg-1', messageId: 'msg-1', createdAt: 10 },
  entry: 'notification',
});

const tail: LandingTarget = { kind: 'tail' };
const anchor: LandingTarget = {
  kind: 'anchor',
  conversationId: 'msg-1',
  messageId: 'msg-1',
  createdAt: 10,
};

const tailLocation = (): ResolvedLocation => ({
  surface: { kind: 'channel', channelId: 'channel-1' },
  anchor: null,
  unreadBoundary: null,
});

const anchorLocation = (): ResolvedLocation => ({
  surface: { kind: 'channel', channelId: 'channel-1' },
  anchor: { conversationId: 'msg-1', messageId: 'msg-1', createdAt: 10 },
  unreadBoundary: null,
});

const facts = (over: Partial<DataFacts> = {}): DataFacts => ({ ...EMPTY_FACTS, ...over });
const metrics = (over: Partial<ListMetrics> = {}): ListMetrics => ({
  targetPlaced: false,
  ...over,
});

const resolving = (startedAt = 0, i = intent()): Extract<OpenState, { status: 'resolving' }> => ({
  status: 'resolving',
  intent: i,
  startedAt,
});

const loading = (
  startedAt = 0,
  i = intent(),
  target: LandingTarget = tail,
): Extract<OpenState, { status: 'loading' }> => ({
  status: 'loading',
  intent: i,
  target,
  startedAt,
});

const placing = (
  startedAt = 0,
  i = intent(),
  target: LandingTarget = tail,
): Extract<OpenState, { status: 'placing' }> => ({
  status: 'placing',
  intent: i,
  target,
  source: 'warm',
  startedAt,
});

const ready = (
  i = intent(),
  target: LandingTarget = tail,
): Extract<OpenState, { status: 'ready' }> => ({
  status: 'ready',
  intent: i,
  target,
  source: 'warm',
});

const errored = (i: OpenIntent | null = intent()): Extract<OpenState, { status: 'error' }> => ({
  status: 'error',
  intent: i,
  failure: { reason: 'timeout', stage: 'loading' },
});

const sampleActions = (key: string, i: OpenIntent): OpenAction[] => [
  { type: 'open', intent: i, now: 1, intentKey: key },
  { type: 'reanchor', target: anchor, now: 1, intentKey: key },
  { type: 'surfaceResolved', location: tailLocation(), now: 1, intentKey: key },
  { type: 'warmWindowRead', containsTarget: true, hasRows: true, now: 1, intentKey: key },
  { type: 'dataFactsChanged', facts: EMPTY_FACTS, now: 1, intentKey: key },
  { type: 'landingConfirmed', metrics: metrics(), intentKey: key },
  { type: 'userTookOwnership', intentKey: key },
  { type: 'tick', now: 1, intentKey: key },
  { type: 'retry', now: 1, intentKey: key },
  { type: 'fail', failure: { reason: 'not-found' }, intentKey: key },
  { type: 'teardown', intentKey: key },
];

const STATES: OpenState[] = [IDLE_STATE, resolving(), loading(), placing(), ready(), errored()];

const resolve = (
  state = resolving(),
  location: ResolvedLocation = tailLocation(),
  now = 1,
): OpenState => openReducer(state, { type: 'surfaceResolved', location, now, intentKey: KEY });

describe('openReducer totality', (): void => {
  it('every (status × action) pair produces a defined state (no undefined, no throw)', (): void => {
    assert.equal(sampleActions(KEY, intent()).length, OPEN_ACTION_TYPES.length);
    for (const state of STATES) {
      for (const action of sampleActions(KEY, intent())) {
        const next = openReducer(state, action);
        assert.equal(typeof next, 'object');
        assert.ok(next.status);
      }
    }
  });
});

describe('I1–I4 visibility', (): void => {
  it('for every (status × hasPaintableRows × containsTarget) pair, exactly one of surface / skeleton / error is visible', (): void => {
    const anchoredPlacing = placing(0, anchored, anchor);
    for (const state of [...STATES, anchoredPlacing]) {
      for (const hasPaintableRows of [false, true]) {
        for (const containsTarget of [false, true]) {
          const f = facts({ hasPaintableRows, containsTarget });
          const flags = [
            isSurfaceVisible(state, f),
            isSkeletonVisible(state, f),
            isErrorVisible(state),
          ];
          assert.equal(
            flags.filter(Boolean).length,
            1,
            `${state.status} rows=${hasPaintableRows} target=${containsTarget} → ${flags.join(',')}`,
          );
        }
      }
    }
  });

  it('warm placing shows the rows with no skeleton over them', (): void => {
    const state = placing();
    const f = facts({ hasPaintableRows: true, hasWarmWindow: true, warmContainsTarget: true });
    assert.equal(isSurfaceVisible(state, f), true);
    assert.equal(isSkeletonVisible(state, f), false);
    assert.equal(isErrorVisible(state), false);
  });

  it('anchor without the target stays on the skeleton, never the latest page', (): void => {
    const state = loading(0, anchored, anchor);
    const f = facts({
      hasPaintableRows: true,
      hasWarmWindow: true,
      warmContainsTarget: false,
      containsTarget: false,
    });
    assert.equal(isSurfaceVisible(state, f), false);
    assert.equal(isSkeletonVisible(state, f), true);
    assert.equal(isErrorVisible(state), false);
  });

  it('only a genuinely empty non-terminal state shows the skeleton', (): void => {
    assert.equal(isSkeletonVisible(resolving(), EMPTY_FACTS), true);
    assert.equal(isSkeletonVisible(loading(), EMPTY_FACTS), true);
    assert.equal(isSkeletonVisible(placing(), facts({ hasPaintableRows: true })), false);
    assert.equal(isSkeletonVisible(errored(), EMPTY_FACTS), false);
    assert.equal(isSkeletonVisible(ready(), EMPTY_FACTS), false);
  });
});

describe('I5 timeouts', (): void => {
  it('resolving past its budget keeps waiting instead of blanking the chat', (): void => {
    const next = openReducer(resolving(0), {
      type: 'tick',
      now: STAGE_BUDGET_MS.resolving,
      intentKey: KEY,
    });
    assert.equal(next.status, 'resolving');
  });

  it('loading past its budget keeps waiting instead of blanking the chat', (): void => {
    const next = openReducer(loading(0, anchored, anchor), {
      type: 'tick',
      now: STAGE_BUDGET_MS.loading,
      intentKey: KEY,
    });
    assert.equal(next.status, 'loading');
  });

  it('placing past its budget force-reveals at the best-known position', (): void => {
    const tailReady = openReducer(placing(0, intent(), tail), {
      type: 'tick',
      now: STAGE_BUDGET_MS.placing,
      intentKey: KEY,
    });
    assert.equal(tailReady.status, 'ready');
    const anchorReady = openReducer(placing(0, anchored, anchor), {
      type: 'tick',
      now: STAGE_BUDGET_MS.placing,
      intentKey: KEY,
    });
    assert.equal(anchorReady.status, 'ready');
  });

  it('tick inside the budget is a no-op', (): void => {
    assert.equal(
      openReducer(resolving(0), { type: 'tick', now: 1, intentKey: KEY }).status,
      'resolving',
    );
    assert.equal(
      openReducer(loading(0), { type: 'tick', now: 1, intentKey: KEY }).status,
      'loading',
    );
    assert.equal(
      openReducer(placing(0), { type: 'tick', now: 1, intentKey: KEY }).status,
      'placing',
    );
  });
});

describe('I6 target lock', (): void => {
  it('surfaceResolved is accepted only in resolving and sets target once', (): void => {
    const start = resolve(resolving(), anchorLocation());
    assert.equal(start.status, 'loading');
    if (start.status !== 'loading') {
      throw new Error('expected loading');
    }
    assert.deepEqual(start.target, anchor);

    const ignored = openReducer(start, {
      type: 'surfaceResolved',
      location: tailLocation(),
      now: 20,
      intentKey: KEY,
    });
    assert.equal(ignored.status, 'loading');
    if (ignored.status === 'loading') {
      assert.deepEqual(ignored.target, anchor);
    }
  });

  it('target never changes after loading/placing entry except via reanchor', (): void => {
    const start = resolve(resolving(), anchorLocation());
    if (start.status !== 'loading') {
      throw new Error('expected loading');
    }
    const locked = start.target;
    const afterFacts = openReducer(start, {
      type: 'dataFactsChanged',
      facts: facts({
        hasPaintableRows: true,
        containsTarget: true,
        liveIsAuthoritative: true,
      }),
      now: 20,
      intentKey: KEY,
    });
    if (afterFacts.status === 'placing' || afterFacts.status === 'ready') {
      assert.deepEqual(afterFacts.target, locked);
    }
  });
});

describe('I7 placing confirmation', (): void => {
  it('placing → ready via landingConfirmed is impossible without confirmation', (): void => {
    const next = openReducer(placing(0, anchored, anchor), {
      type: 'landingConfirmed',
      metrics: metrics({ targetPlaced: false }),
      intentKey: KEY,
    });
    assert.equal(next.status, 'placing');
  });

  it('confirmed landing moves placing to ready', (): void => {
    const next = openReducer(placing(0, anchored, anchor), {
      type: 'landingConfirmed',
      metrics: metrics({ targetPlaced: true }),
      intentKey: KEY,
    });
    assert.equal(next.status, 'ready');
  });
});

describe('I8 warm vs live', (): void => {
  it('a partial live window cannot supersede a warm window containing the target', (): void => {
    const seeded = openReducer(resolve(resolving(), anchorLocation()), {
      type: 'warmWindowRead',
      containsTarget: true,
      hasRows: true,
      now: 5,
      intentKey: KEY,
    });
    assert.equal(seeded.status, 'placing');
    if (seeded.status !== 'placing') {
      throw new Error('expected placing');
    }
    assert.equal(seeded.source, 'warm');

    const partial = openReducer(seeded, {
      type: 'dataFactsChanged',
      facts: facts({
        hasPaintableRows: true,
        containsTarget: true,
        hasWarmWindow: true,
        warmContainsTarget: true,
        liveIsAuthoritative: false,
      }),
      now: 15,
      intentKey: KEY,
    });
    assert.equal(partial.status, 'placing');
    if (partial.status === 'placing') {
      assert.equal(partial.source, 'warm');
    }
  });
});

describe('I9 duplicate open', (): void => {
  it('duplicate open with the same intentKey while non-terminal is a no-op', (): void => {
    const state = resolving(0);
    assert.equal(
      openReducer(state, { type: 'open', intent: intent(), now: 50, intentKey: KEY }),
      state,
    );
    const loadingState = loading(0);
    assert.equal(
      openReducer(loadingState, { type: 'open', intent: intent(), now: 50, intentKey: KEY }),
      loadingState,
    );
  });
});

describe('I10 stale continuations and teardown', (): void => {
  it('every async continuation is a no-op when its intentKey does not match current state', (): void => {
    const state = resolving();
    for (const action of sampleActions(OTHER, intent({ intentKey: OTHER }))) {
      if (action.type === 'open' || action.type === 'teardown') {
        continue;
      }
      assert.equal(openReducer(state, action), state, action.type);
    }
  });

  it('teardown from every non-terminal status reaches idle', (): void => {
    for (const state of [resolving(), loading(), placing(), ready()]) {
      const next = openReducer(state, { type: 'teardown', intentKey: KEY });
      assert.deepEqual(next, IDLE_STATE, state.status);
    }
  });

  it('mismatched teardown does not idle a live open', (): void => {
    const state = resolving();
    assert.equal(openReducer(state, { type: 'teardown', intentKey: OTHER }), state);
  });
});

describe('I11 reanchor', (): void => {
  it('starts a new hunt from loading, placing, or ready on the same intentKey', (): void => {
    const other: LandingTarget = {
      kind: 'anchor',
      conversationId: 'msg-2',
      messageId: 'msg-2',
      createdAt: 20,
    };

    const fromReady = openReducer(ready(), {
      type: 'reanchor',
      target: other,
      now: 40,
      intentKey: KEY,
    });
    assert.equal(fromReady.status, 'loading');
    if (fromReady.status === 'loading') {
      assert.deepEqual(fromReady.target, other);
      assert.equal(fromReady.startedAt, 40);
    }
  });

  it('a changed intentKey remounts instead', (): void => {
    const state = ready();
    const next = openReducer(state, {
      type: 'reanchor',
      target: anchor,
      now: 40,
      intentKey: OTHER,
    });
    assert.equal(next, state);
  });
});

describe('retry', (): void => {
  it('retry from error re-enters resolving under the same intentKey', (): void => {
    const next = openReducer(errored(), { type: 'retry', now: 80, intentKey: KEY });
    assert.equal(next.status, 'resolving');
    if (next.status === 'resolving') {
      assert.equal(next.intent.intentKey, KEY);
      assert.equal(next.startedAt, 80);
    }
  });

  it('retry cannot double-apply from loading', (): void => {
    const state = loading(80);
    assert.equal(openReducer(state, { type: 'retry', now: 90, intentKey: KEY }), state);
  });
});

describe('initFromIntent', (): void => {
  it('lazily initialises straight into resolving so idle never renders', (): void => {
    const state = initFromIntent(intent(), 1);
    assert.equal(state.status, 'resolving');
    assert.equal(
      openReducer(IDLE_STATE, { type: 'open', intent: intent(), now: 1, intentKey: KEY }).status,
      'resolving',
    );
  });

  it('warm window that contains the target skips to placing after resolve', (): void => {
    const next = openReducer(resolve(resolving(), anchorLocation()), {
      type: 'warmWindowRead',
      containsTarget: true,
      hasRows: true,
      now: 5,
      intentKey: KEY,
    });
    assert.equal(next.status, 'placing');
  });

  it('warm miss with an anchored intent stays loading', (): void => {
    const next = openReducer(resolve(resolving(0, anchored), anchorLocation()), {
      type: 'warmWindowRead',
      containsTarget: false,
      hasRows: true,
      now: 5,
      intentKey: KEY,
    });
    assert.equal(next.status, 'loading');
  });

  it('warm and facts are ignored while still resolving', (): void => {
    assert.equal(
      openReducer(resolving(), {
        type: 'warmWindowRead',
        containsTarget: true,
        hasRows: true,
        now: 5,
        intentKey: KEY,
      }).status,
      'resolving',
    );
    assert.equal(
      openReducer(resolving(), {
        type: 'dataFactsChanged',
        facts: facts({ hasPaintableRows: true }),
        now: 5,
        intentKey: KEY,
      }).status,
      'resolving',
    );
  });
});

describe('empty settled chat (v2 parity)', (): void => {
  it('empty finished window is ready, not a loading error', (): void => {
    const next = openReducer(loading(), {
      type: 'dataFactsChanged',
      facts: facts({ isInitialLoadComplete: true }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'ready');
  });

  it('empty unfinished window stays loading', (): void => {
    const next = openReducer(loading(), {
      type: 'dataFactsChanged',
      facts: facts({ isInitialLoadComplete: false }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'loading');
  });
});

describe('anchored target settlement', (): void => {
  it('does not fail while the initial window is still hydrating', (): void => {
    const next = openReducer(loading(0, anchored, anchor), {
      type: 'dataFactsChanged',
      facts: facts({
        containsTarget: false,
        expansionExhausted: true,
        isInitialLoadComplete: false,
        liveIsAuthoritative: false,
      }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'loading');
  });

  it('fails after an authoritative settled window exhausts the anchor', (): void => {
    const next = openReducer(loading(0, anchored, anchor), {
      type: 'dataFactsChanged',
      facts: facts({
        hasPaintableRows: true,
        containsTarget: false,
        expansionExhausted: true,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'error');
    if (next.status === 'error') {
      assert.deepEqual(next.failure, { reason: 'anchor-unreachable' });
    }
  });

  it('does not place a live tail that cannot land the anchor', (): void => {
    const next = openReducer(loading(0, anchored, anchor), {
      type: 'dataFactsChanged',
      facts: facts({
        hasPaintableRows: true,
        containsTarget: false,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'loading');
  });

  it('fails when the live subscribe reports an error and the target cannot land', (): void => {
    const next = openReducer(loading(), {
      type: 'dataFactsChanged',
      facts: facts({ liveLoadFailed: true }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'error');
    if (next.status === 'error') {
      assert.deepEqual(next.failure, { reason: 'live-error' });
    }
  });

  it('errors when live subscribe fails and the anchor is not in the visible rows', (): void => {
    const next = openReducer(loading(0, anchored, anchor), {
      type: 'dataFactsChanged',
      facts: facts({ liveLoadFailed: true, hasPaintableRows: true, containsTarget: false }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'error');
  });

  it('places a landable window when live subscribe fails but the target is present', (): void => {
    const next = openReducer(loading(), {
      type: 'dataFactsChanged',
      facts: facts({ liveLoadFailed: true, hasPaintableRows: true, containsTarget: true }),
      now: 1,
      intentKey: KEY,
    });
    assert.equal(next.status, 'placing');
  });
});
