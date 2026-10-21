import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  hasDecidedBetaPromo,
  markBetaPromoDecided,
  resetBetaPromoSessionForTest,
} from '@/src/features/beta-flags/beta-promo-session';
import {
  decideBetaPromo,
  isHomeTabRoute,
  pendingBetaFlags,
  summarizePendingLabels,
  type BetaPromoInput,
} from '@/src/features/beta-flags/promo';
import type { BetaFlag } from '@/src/features/beta-flags/resolve';
import type { FlagKey } from '@/src/flags/registry';

const flag = (key: FlagKey, label: string): BetaFlag => ({ key, label, description: '' });

const shell = flag('ui.shell', 'New navigation');
const chat = flag('chat.v3', 'Chat v3');
const dms = flag('ui.dms', 'New DMs screen');
const channels = flag('ui.channels', 'New Channels screen');

const storedOn =
  (...on: FlagKey[]) =>
  (key: FlagKey): boolean =>
    on.includes(key);

const base: BetaPromoInput = {
  promptEnabled: true,
  hasError: false,
  visible: [shell, chat, dms, channels],
  isStoredOn: storedOn('ui.shell'),
  revokedCount: 0,
  updatePromptDue: false,
  isOnHomeTab: true,
};

describe('decideBetaPromo', () => {
  it('shows while some visible flags are off, listing only those', () => {
    const decision = decideBetaPromo(base);
    assert.equal(decision.show, true);
    assert.deepEqual(decision.show ? decision.pending.map(f => f.key) : [], [
      'chat.v3',
      'ui.dms',
      'ui.channels',
    ]);
  });

  it('stops once every visible flag is on', () => {
    const decision = decideBetaPromo({
      ...base,
      isStoredOn: storedOn('ui.shell', 'chat.v3', 'ui.dms', 'ui.channels'),
    });
    assert.deepEqual(decision, { show: false, reason: 'all_enabled' });
  });

  it('comes back when a visible flag is turned off again', () => {
    const decision = decideBetaPromo({
      ...base,
      isStoredOn: storedOn('ui.shell', 'ui.dms', 'ui.channels'),
    });
    assert.equal(decision.show, true);
  });

  it('only counts flags this user can see', () => {
    // A user granted two flags who has both on is done, whatever else exists.
    const decision = decideBetaPromo({
      ...base,
      visible: [shell, chat],
      isStoredOn: storedOn('ui.shell', 'chat.v3'),
    });
    assert.deepEqual(decision, { show: false, reason: 'all_enabled' });
  });

  const skips: [string, Partial<BetaPromoInput>, string][] = [
    ['the CAC switch is off', { promptEnabled: false }, 'prompt_disabled'],
    ['a beta key failed', { hasError: true }, 'cac_error'],
    ['the revocation sheet owns the launch', { revokedCount: 1 }, 'revoked_pending'],
    ['the update prompt owns the launch', { updatePromptDue: true }, 'update_prompt_pending'],
    ['nothing is granted', { visible: [] }, 'no_visible_flags'],
    ['the cold start is not on a home tab', { isOnHomeTab: false }, 'not_on_home_tab'],
  ];

  for (const [name, override, reason] of skips) {
    it(`skips when ${name}`, () => {
      assert.deepEqual(decideBetaPromo({ ...base, ...override }), { show: false, reason });
    });
  }

  it('lets the kill switch win over everything', () => {
    assert.deepEqual(
      decideBetaPromo({ ...base, promptEnabled: false, hasError: true, updatePromptDue: true }),
      { show: false, reason: 'prompt_disabled' },
    );
  });

  it('never guesses eligibility from a failed check', () => {
    assert.deepEqual(decideBetaPromo({ ...base, hasError: true, visible: [] }), {
      show: false,
      reason: 'cac_error',
    });
  });
});

describe('pendingBetaFlags', () => {
  it('uses the stored switch, so a child on under an off parent is not pending', () => {
    // `ui.dms` requires `ui.shell`. The pinned snapshot would force it off, but
    // the user did turn it on; only the parent is still to do.
    assert.deepEqual(
      pendingBetaFlags([shell, dms], storedOn('ui.dms')).map(f => f.key),
      ['ui.shell'],
    );
  });

  it('counts a child as pending when its parent is on and it is off', () => {
    assert.deepEqual(
      pendingBetaFlags([shell, dms], storedOn('ui.shell')).map(f => f.key),
      ['ui.dms'],
    );
  });
});

describe('summarizePendingLabels', () => {
  it('names one, two or three flags and folds the rest', () => {
    assert.equal(summarizePendingLabels([]), '');
    assert.equal(summarizePendingLabels([chat]), 'Chat v3');
    assert.equal(summarizePendingLabels([chat, dms]), 'Chat v3 and New DMs screen');
    assert.equal(
      summarizePendingLabels([shell, chat, dms]),
      'New navigation, Chat v3 and New DMs screen',
    );
    assert.equal(
      summarizePendingLabels([shell, chat, dms, channels]),
      'New navigation, Chat v3 and 2 more',
    );
  });
});

describe('isHomeTabRoute', () => {
  it('matches tab screens of either shell', () => {
    assert.equal(isHomeTabRoute(['(protected)', '(tabs)', 'dms']), true);
    assert.equal(isHomeTabRoute(['(protected)', '(spaces)', 'channels']), true);
  });

  it('rejects anything stacked over the shell', () => {
    assert.equal(isHomeTabRoute(['(protected)', 'chat', '[channelId]']), false);
    assert.equal(isHomeTabRoute(['(protected)', 'native-call']), false);
    assert.equal(isHomeTabRoute(['(protected)', 'share-target']), false);
    assert.equal(isHomeTabRoute(['(protected)', 'settings', 'beta']), false);
    assert.equal(isHomeTabRoute(['(protected)']), false);
  });
});

describe('beta promo session marker', () => {
  beforeEach(() => {
    resetBetaPromoSessionForTest();
  });

  it('remembers the decision for the rest of the process', () => {
    assert.equal(hasDecidedBetaPromo('u1'), false);
    markBetaPromoDecided('u1');
    assert.equal(hasDecidedBetaPromo('u1'), true);
  });

  it('gives a different account in the same process its own decision', () => {
    markBetaPromoDecided('u1');
    assert.equal(hasDecidedBetaPromo('u2'), false);
  });
});
