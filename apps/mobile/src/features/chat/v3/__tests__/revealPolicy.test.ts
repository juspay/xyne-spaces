import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OpenIntent } from '../intent/openIntent.types';
import { openReducer } from '../machine/openReducer';
import {
  canLandFromHint,
  classifyOpen,
  isLandingConfirmed,
  isWeakerLanding,
  landingKeyFor,
  resolvedLocationForOpen,
} from '../machine/revealPolicy';
import type { ResolvedLocation } from '../intent/resolvedLocation';
import { isErrorVisible, isSkeletonVisible, isSurfaceVisible } from '../machine/selectors';
import {
  EMPTY_FACTS,
  type DataFacts,
  type ListMetrics,
  type OpenState,
} from '../machine/openState';

const KEY = 'channel:channel-1';

const channelIntent = (): OpenIntent => ({
  intentKey: KEY,
  surface: { kind: 'channel', channelId: 'channel-1' },
  entry: 'tap',
  isColdStart: false,
  raw: {},
  hint: { channelId: 'channel-1' },
});

const anchoredIntent = (): OpenIntent => ({
  ...channelIntent(),
  entry: 'notification',
  hint: {
    channelId: 'channel-1',
    conversationId: 'notified-reply',
    messageId: 'notified-reply',
    createdAt: 300,
  },
});

const facts = (over: Partial<DataFacts> = {}): DataFacts => ({ ...EMPTY_FACTS, ...over });

const metrics = (over: Partial<ListMetrics> = {}): ListMetrics => ({
  targetPlaced: false,
  ...over,
});

const NO_METRICS = metrics();

const resolving = (intent: OpenIntent): OpenState => ({
  status: 'resolving',
  intent,
  startedAt: 0,
});

const placing = (
  intent: OpenIntent,
  over: Partial<Extract<OpenState, { status: 'placing' }>> = {},
): OpenState => ({
  status: 'placing',
  intent,
  target: classifyOpen(intent),
  source: 'warm',
  startedAt: 0,
  ...over,
});

const loading = (intent: OpenIntent): OpenState => ({
  status: 'loading',
  intent,
  target: classifyOpen(intent),
  startedAt: 0,
});

const rows = facts({
  hasPaintableRows: true,
  containsTarget: true,
  hasWarmWindow: true,
  warmContainsTarget: true,
});

const seededTail = facts({
  hasPaintableRows: true,
  containsTarget: false,
  hasWarmWindow: true,
  warmContainsTarget: false,
});

const warmRead = (
  state: OpenState,
  containsTarget: boolean,
  hasRows: boolean,
  now = 5,
): OpenState =>
  openReducer(state, { type: 'warmWindowRead', containsTarget, hasRows, now, intentKey: KEY });

const factsChanged = (state: OpenState, next: DataFacts, now = 10): OpenState =>
  openReducer(state, { type: 'dataFactsChanged', facts: next, now, intentKey: KEY });

const confirm = (state: OpenState, placed: ListMetrics): OpenState =>
  openReducer(state, { type: 'landingConfirmed', metrics: placed, intentKey: KEY });

const takeOwnership = (state: OpenState): OpenState =>
  openReducer(state, { type: 'userTookOwnership', intentKey: KEY });

const locationFor = (openIntent: OpenIntent): ResolvedLocation => {
  const target = classifyOpen(openIntent);
  if (target.kind === 'anchor') {
    return {
      surface: openIntent.surface,
      anchor: {
        conversationId: target.conversationId,
        messageId: target.messageId,
        createdAt: target.createdAt > 0 ? target.createdAt : 300,
      },
      unreadBoundary: null,
    };
  }
  return { surface: openIntent.surface, anchor: null, unreadBoundary: null };
};

const resolved = (openIntent: OpenIntent): OpenState =>
  openReducer(resolving(openIntent), {
    type: 'surfaceResolved',
    location: locationFor(openIntent),
    now: 1,
    intentKey: KEY,
  });

describe('chat open reveal policy', (): void => {
  it('classifies the three opening cases from one local snapshot', (): void => {
    // empty: nothing cached, still hunting.
    assert.equal(warmRead(resolved(anchoredIntent()), false, false).status, 'loading');
    // seeded-target: the cached window holds the requested anchor.
    const seededTargetState = warmRead(resolved(anchoredIntent()), true, true);
    assert.equal(seededTargetState.status, 'placing');
    // cached rows exist but not the requested anchor — stay loading, never seed the tail.
    assert.equal(warmRead(resolved(anchoredIntent()), false, true).status, 'loading');
    // no requested anchor: any cached rows are the target window.
    assert.equal(warmRead(resolved(channelIntent()), false, true).status, 'placing');
  });

  it('never reveals an empty window', (): void => {
    const state = loading(channelIntent());
    const next = factsChanged(state, EMPTY_FACTS);
    assert.equal(next.status, 'loading');
    assert.equal(isSurfaceVisible(next, EMPTY_FACTS), false);
    assert.equal(isSkeletonVisible(next, EMPTY_FACTS), true);
  });

  it('keeps tail placement pending until the native viewport reaches the end', (): void => {
    const next = factsChanged(resolved(channelIntent()), facts({ hasPaintableRows: true }));
    assert.equal(next.status, 'placing');
    assert.equal(isSurfaceVisible(next, facts({ hasPaintableRows: true })), true);
    assert.equal(isLandingConfirmed({ kind: 'tail' }, NO_METRICS), false);
    assert.equal(confirm(next, NO_METRICS).status, 'placing');
    assert.equal(confirm(next, metrics({ targetPlaced: true })).status, 'ready');
  });

  it('uses tail and anchor placement metrics independently', (): void => {
    const tailOpen = placing(channelIntent());
    assert.equal(confirm(tailOpen, metrics({ targetPlaced: false })).status, 'placing');
    assert.equal(confirm(tailOpen, metrics({ targetPlaced: true })).status, 'ready');
    const anchoredOpen = placing(anchoredIntent());
    assert.equal(confirm(anchoredOpen, metrics({ targetPlaced: false })).status, 'placing');
  });

  it('does not paint a seeded tail while the anchored target is still missing', (): void => {
    const state = loading(anchoredIntent());
    assert.equal(isSurfaceVisible(state, seededTail), false);
    assert.equal(isSkeletonVisible(state, seededTail), true);
  });

  it('user ownership of a tail placement still reaches ready', (): void => {
    const state = placing(channelIntent());
    const next = takeOwnership(state);
    assert.equal(next.status, 'ready');
  });

  it('reveals an anchored open as soon as rows exist', (): void => {
    const state = placing(anchoredIntent());
    assert.equal(isSurfaceVisible(state, rows), true);
    assert.equal(isSkeletonVisible(state, rows), false);
  });

  it('does not reveal provisional latest rows for an anchored open', (): void => {
    const state = placing(anchoredIntent());
    const provisional = facts({ hasPaintableRows: true, containsTarget: false });
    assert.equal(isSurfaceVisible(state, provisional), false);
    assert.equal(isSkeletonVisible(state, provisional), true);
  });

  it('does not put a second shimmer over a warm target while native placement confirms', (): void => {
    const state = placing(anchoredIntent());
    assert.equal(isSkeletonVisible(state, rows), false);
    assert.equal(isSurfaceVisible(state, rows), true);
    assert.equal(confirm(state, NO_METRICS).status, 'placing');
  });

  it('reveals an unanchored provisional window before the query completes', (): void => {
    const state = loading(channelIntent());
    const provisional = facts({ hasPaintableRows: true });
    assert.equal(isSurfaceVisible(state, provisional), true);
    assert.equal(isSkeletonVisible(state, provisional), false);
  });

  it('lets a user drag or an already-revealable window take ownership over blocking', (): void => {
    const state = placing(anchoredIntent());
    assert.equal(takeOwnership(state).status, 'ready');
    assert.equal(confirm(state, metrics({ targetPlaced: true })).status, 'ready');
  });

  it('holds warm rows without showing a second shimmer until placement confirms', (): void => {
    const state = placing(anchoredIntent());
    const held = confirm(state, NO_METRICS);
    assert.equal(held.status, 'placing');
    assert.equal(isSkeletonVisible(held, rows), false);
    assert.equal(isSurfaceVisible(held, rows), true);
    assert.equal(takeOwnership(state).status, 'ready');
    // The empty case never holds: there is nothing painted to hold.
    assert.equal(isSkeletonVisible(loading(anchoredIntent()), EMPTY_FACTS), true);
  });

  it('reveals a seeded tail while the anchored target is still loading', (): void => {
    const state = loading(anchoredIntent());
    assert.equal(isSurfaceVisible(state, seededTail), false);
    assert.equal(isSkeletonVisible(state, seededTail), true);
  });

  it('keeps hunting while rows are visible but the anchor is still missing', (): void => {
    const next = factsChanged(
      loading(anchoredIntent()),
      facts({
        hasPaintableRows: true,
        containsTarget: false,
        expansionExhausted: true,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
    );
    assert.equal(next.status, 'error');
    assert.equal(isErrorVisible(next), true);
  });

  it('fails only when an exhausted anchor miss has nothing to paint', (): void => {
    const next = factsChanged(
      loading(anchoredIntent()),
      facts({
        hasPaintableRows: false,
        containsTarget: false,
        expansionExhausted: true,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
    );
    assert.equal(next.status, 'error');
    if (next.status === 'error') {
      assert.deepEqual(next.failure, { reason: 'anchor-unreachable' });
    }
    assert.equal(isErrorVisible(next), true);
    assert.equal(isSurfaceVisible(next, facts({ hasPaintableRows: true })), false);
  });

  it('does not make a missing anchor terminal while resolution, sync, or expansion is still active', (): void => {
    const base = {
      hasPaintableRows: true,
      containsTarget: false,
      expansionExhausted: true,
      isInitialLoadComplete: true,
      liveIsAuthoritative: true,
    };
    // Live window not authoritative yet: the warm snapshot cannot condemn the anchor.
    assert.equal(
      factsChanged(loading(anchoredIntent()), facts({ ...base, liveIsAuthoritative: false }))
        .status,
      'loading',
    );
    // Initial query still hydrating.
    assert.equal(
      factsChanged(loading(anchoredIntent()), facts({ ...base, isInitialLoadComplete: false }))
        .status,
      'loading',
    );
    // Expansion still has passes left.
    assert.equal(
      factsChanged(loading(anchoredIntent()), facts({ ...base, expansionExhausted: false })).status,
      'loading',
    );
  });

  it('never shows a missing-anchor state after the exact target is present', (): void => {
    const next = factsChanged(
      loading(anchoredIntent()),
      facts({
        hasPaintableRows: true,
        containsTarget: true,
        expansionExhausted: true,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
    );
    assert.equal(next.status, 'placing');
    assert.equal(isErrorVisible(next), false);
  });

  it('keeps hunting after a seeded-tail warm read while live catches up', (): void => {
    const state = loading(anchoredIntent());
    const ticked = openReducer(state, { type: 'tick', now: 60_000, intentKey: KEY });
    assert.equal(ticked.status, 'loading');
  });

  it('lets any usable rows render before the query completes', (): void => {
    const state = loading(channelIntent());
    const hydrating = facts({ hasPaintableRows: true });
    assert.equal(isSurfaceVisible(state, hydrating), true);
    assert.equal(isSkeletonVisible(state, hydrating), false);
  });

  it('lets cached notification rows paint while the live query hydrates', (): void => {
    const state = placing(anchoredIntent());
    assert.equal(isSurfaceVisible(state, rows), true);
    assert.equal(isSkeletonVisible(state, rows), false);
  });

  it('never lets a warm anchor seed render messages that do not exist', (): void => {
    const state = loading(anchoredIntent());
    assert.equal(isSurfaceVisible(state, EMPTY_FACTS), false);
    assert.equal(isSkeletonVisible(state, EMPTY_FACTS), true);
  });

  it('treats a thread without a requested target as already cached', (): void => {
    const next = warmRead(resolved(channelIntent()), false, true);
    assert.equal(next.status, 'placing');
    if (next.status === 'placing') {
      assert.equal(next.source, 'warm');
    }
  });

  it('enters placing for a visited thread even when the notified message is missing', (): void => {
    assert.equal(warmRead(resolved(anchoredIntent()), false, true).status, 'loading');
    assert.equal(warmRead(resolved(anchoredIntent()), true, true).status, 'placing');
  });

  it('falls back to the live result when the opening window never had the target', (): void => {
    const missed = warmRead(resolved(anchoredIntent()), false, true);
    assert.equal(missed.status, 'loading');
    const live = factsChanged(
      missed,
      facts({ hasPaintableRows: true, containsTarget: true, liveIsAuthoritative: true }),
    );
    assert.equal(live.status, 'placing');
  });

  it('falls back to the live result when there is no requested target at all', (): void => {
    const live = factsChanged(
      resolved(channelIntent()),
      facts({ hasPaintableRows: true, liveIsAuthoritative: true }),
    );
    assert.equal(live.status, 'placing');
    if (live.status === 'placing') {
      assert.equal(live.source, 'live');
    }
  });
});

describe('notification open with a restored warm window', (): void => {
  it('classifies the restored window as a seeded target', (): void => {
    const next = warmRead(resolved(anchoredIntent()), true, true);
    assert.equal(next.status, 'placing');
    if (next.status === 'placing') {
      assert.equal(next.source, 'warm');
      assert.equal(next.target.kind, 'anchor');
    }
  });

  it('never shows the skeleton while the warm window is on screen', (): void => {
    const state = placing(anchoredIntent());
    assert.equal(confirm(state, NO_METRICS).status, 'placing');
    assert.equal(isSkeletonVisible(state, rows), false);
    assert.equal(isSurfaceVisible(state, rows), true);
  });

  it('still shows the skeleton when there genuinely is no warm data', (): void => {
    const next = warmRead(resolved(anchoredIntent()), false, false);
    assert.equal(next.status, 'loading');
    assert.equal(isSkeletonVisible(next, EMPTY_FACTS), true);
    assert.equal(isSurfaceVisible(next, EMPTY_FACTS), false);
  });
});

describe('notification open into a previously visited thread', (): void => {
  it('paints the visited window while the notification target is still loading', (): void => {
    const next = warmRead(resolved(anchoredIntent()), false, true);
    assert.equal(next.status, 'loading');
    assert.equal(isSurfaceVisible(next, seededTail), false);
    assert.equal(isSkeletonVisible(next, seededTail), true);
  });

  it('paints immediately when the visited window already holds the target', (): void => {
    const next = warmRead(resolved(anchoredIntent()), true, true);
    assert.equal(next.status, 'placing');
    if (next.status === 'placing') {
      assert.equal(next.source, 'warm');
    }
    assert.equal(isSurfaceVisible(next, rows), true);
    assert.equal(isSkeletonVisible(next, rows), false);
  });

  it('hands over to the settled live window once it is authoritative', (): void => {
    const settled = facts({
      hasPaintableRows: true,
      containsTarget: true,
      hasWarmWindow: true,
      warmContainsTarget: true,
      liveIsAuthoritative: true,
    });
    const next = factsChanged(placing(anchoredIntent(), { source: 'warm' }), settled);
    assert.equal(next.status, 'placing');
    if (next.status === 'placing') {
      assert.equal(next.source, 'warm+live');
    }
    assert.equal(isSurfaceVisible(next, settled), true);
    assert.equal(isSkeletonVisible(next, settled), false);
  });

  it('still shows the skeleton when there is genuinely nothing cached', (): void => {
    const state = loading(anchoredIntent());
    assert.equal(isSkeletonVisible(state, EMPTY_FACTS), true);
    assert.equal(isSurfaceVisible(state, EMPTY_FACTS), false);
  });

  it('keeps the surface revealed once the notified reply lands', (): void => {
    const landed = confirm(placing(anchoredIntent()), metrics({ targetPlaced: true }));
    assert.equal(landed.status, 'ready');
    assert.equal(isSurfaceVisible(landed, rows), true);
    assert.equal(isSkeletonVisible(landed, rows), false);
  });
});

describe('notification open into a previously visited channel', (): void => {
  it('reveals a window whenever rows are present, regardless of target', (): void => {
    const state = placing(channelIntent());
    assert.equal(isSurfaceVisible(state, facts({ hasPaintableRows: true })), true);
    assert.equal(isSurfaceVisible(state, EMPTY_FACTS), false);
    const next = factsChanged(resolved(channelIntent()), facts({ hasPaintableRows: true }));
    assert.equal(next.status, 'placing');
  });

  it('keeps hunting while rows are visible but the anchor stays unplaced', (): void => {
    const next = factsChanged(
      placing(anchoredIntent()),
      facts({
        hasPaintableRows: true,
        containsTarget: false,
        expansionExhausted: true,
        isInitialLoadComplete: true,
        liveIsAuthoritative: true,
      }),
    );
    assert.equal(next.status, 'error');
    assert.equal(isErrorVisible(next), true);
  });
});

describe('open-path landing classification', (): void => {
  it('lands an unread-open on the last message; the divider is row chrome', (): void => {
    const intent = channelIntent();
    intent.hint.unreadBoundaryAt = 50;
    intent.hint.unreadBoundaryConversationId = 'c-unread';
    assert.deepEqual(classifyOpen(intent), { kind: 'tail' });
    assert.equal(landingKeyFor(intent), 'tail');
  });

  it('prefers a requested message over an unread hint', (): void => {
    const intent = anchoredIntent();
    intent.hint.unreadBoundaryAt = 50;
    const target = classifyOpen(intent);
    assert.equal(target.kind, 'anchor');
  });

  it('lands a deeplink thread on the thread conversation, not the message id', (): void => {
    const intent = channelIntent();
    intent.surface = { kind: 'thread', channelId: 'channel-1', threadId: 'conversation-1' };
    intent.entry = 'deeplink';
    intent.hint = {
      channelId: 'channel-1',
      threadId: 'conversation-1',
      messageId: 'reply-1',
      createdAt: 123,
    };
    assert.deepEqual(classifyOpen(intent), {
      kind: 'anchor',
      conversationId: 'conversation-1',
      createdAt: 0,
      messageId: 'reply-1',
    });
    assert.equal(landingKeyFor(intent), 'anchor:reply-1');
  });

  it('lands an activity thread on the route messageId the way v2 does', (): void => {
    const intent = channelIntent();
    intent.surface = { kind: 'thread', channelId: 'channel-1', threadId: 'conversation-1' };
    intent.entry = 'activity';
    intent.hint = {
      channelId: 'channel-1',
      threadId: 'conversation-1',
      conversationId: 'conversation-1',
      messageId: 'reply-1',
    };
    assert.deepEqual(classifyOpen(intent), {
      kind: 'anchor',
      conversationId: 'conversation-1',
      createdAt: 0,
      messageId: 'reply-1',
    });
    assert.equal(landingKeyFor(intent), 'anchor:reply-1');
    assert.equal(canLandFromHint(intent), true);
    assert.equal(resolvedLocationForOpen(intent, null)?.anchor?.messageId, 'reply-1');
  });

  it('keeps the same landing key while createdAt fills in for a message jump', (): void => {
    const intent = channelIntent();
    intent.surface = { kind: 'thread', channelId: 'channel-1', threadId: 'conversation-1' };
    intent.entry = 'notification';
    intent.hint = {
      channelId: 'channel-1',
      threadId: 'conversation-1',
      messageId: 'reply-1',
    };
    const pending = landingKeyFor(intent);
    intent.hint.createdAt = 99;
    assert.equal(landingKeyFor(intent), pending);
  });

  it('lands tail and unread from the hint; only an anchor must not weaken to tail', (): void => {
    const unread = channelIntent();
    unread.hint.unreadBoundaryAt = 50;
    assert.equal(canLandFromHint(unread), true);
    assert.equal(canLandFromHint(anchoredIntent()), false);
    assert.equal(isWeakerLanding({ kind: 'tail' }, { kind: 'tail' }), false);
    assert.equal(
      isWeakerLanding(
        { kind: 'anchor', conversationId: 'c', messageId: 'm', createdAt: 1 },
        { kind: 'tail' },
      ),
      true,
    );
    assert.equal(isWeakerLanding({ kind: 'tail' }, { kind: 'tail' }), false);
  });

  it('lands from the hint while resolve is still pending', (): void => {
    const unread = channelIntent();
    unread.hint.unreadBoundaryAt = 50;
    unread.hint.unreadBoundaryConversationId = 'c-unread';
    assert.deepEqual(resolvedLocationForOpen(unread, null)?.unreadBoundary, {
      at: 50,
      conversationId: 'c-unread',
    });
    assert.equal(resolvedLocationForOpen(anchoredIntent(), null), null);
  });
});
