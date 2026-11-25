import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HOLD_BLOCK_GAP as GAP,
  HOLD_EDGE_INSET as EDGE,
  HOLD_MAX_CARD_SHARE,
  HOLD_RAIL_HEIGHT,
} from '@/src/features/conversation/constants';
import {
  computeHoldLayout,
  holdMenuCopiedNotice,
  holdMenuLabel,
  holdMenuNaturalHeight,
  orderHoldMenuActions,
  type HoldMenuActionInput,
} from '@/src/features/conversation/model/hold-menu';
import {
  clearHoldSource,
  getHoldSource,
  setHoldSource,
} from '@/src/features/conversation/model/hold-source-store';

const action = (
  id: string,
  label: string,
  extra: Partial<HoldMenuActionInput> = {},
): HoldMenuActionInput => ({ id, label, visible: true, ...extra });

const V2_ORDER: HoldMenuActionInput[] = [
  action('ask-ai', 'Ask AI'),
  action('reply-in-thread', 'Reply in Thread'),
  action('send-to-channel', 'Send to Channel'),
  action('edit-in-chat', 'Edit in Chat'),
  action('copy-message', 'Copy Message'),
  action('copy-link', 'Copy Link'),
  action('forward-message', 'Forward Message'),
  action('copy-image', 'Copy Image'),
  action('pin', 'Pin Message'),
  action('bookmark', 'Add Bookmark'),
  action('remind-me', 'Remind me'),
  action('start-call', 'Start Call'),
  action('mark-as-unread', 'Mark as Unread'),
  action('delete', 'Delete Message', { variant: 'destructive' }),
];

describe('orderHoldMenuActions', () => {
  it('leads with the four Figma rows, then the rest in v2 order, destructive last', () => {
    const ids = orderHoldMenuActions(V2_ORDER).map(a => a.id);
    assert.deepEqual(ids, [
      'reply-in-thread',
      'bookmark',
      'copy-message',
      'ask-ai',
      'send-to-channel',
      'edit-in-chat',
      'copy-link',
      'forward-message',
      'copy-image',
      'pin',
      'remind-me',
      'start-call',
      'mark-as-unread',
      'delete',
    ]);
  });

  it('never drops or adds a visible action', () => {
    const input = V2_ORDER.map((a, i) => (i % 3 === 0 ? { ...a, visible: false } : a));
    const out = orderHoldMenuActions(input);
    assert.deepEqual(
      out.map(a => a.id).sort(),
      input
        .filter(a => a.visible)
        .map(a => a.id)
        .sort(),
    );
  });

  it('keeps hidden actions out', () => {
    const out = orderHoldMenuActions([action('ask-ai', 'Ask AI', { visible: false })]);
    assert.equal(out.length, 0);
  });

  it('keeps retry first and the pending delete last for unsent messages', () => {
    const out = orderHoldMenuActions([
      action('pending-retry', 'Retry Send'),
      action('pending-delete', 'Delete Message', { variant: 'destructive' }),
    ]);
    assert.deepEqual(
      out.map(a => a.id),
      ['pending-retry', 'pending-delete'],
    );
  });

  it('puts a destructive row after the plain ones even when listed earlier', () => {
    const out = orderHoldMenuActions([
      action('delete', 'Delete Message', { variant: 'destructive' }),
      action('copy-link', 'Copy Link'),
    ]);
    assert.deepEqual(
      out.map(a => a.id),
      ['copy-link', 'delete'],
    );
  });

  it('maps Figma wording and leaves the rest alone', () => {
    const byId = Object.fromEntries(orderHoldMenuActions(V2_ORDER).map(a => [a.id, a.menuLabel]));
    assert.equal(byId['reply-in-thread'], 'Reply in thread');
    assert.equal(byId['bookmark'], 'Add to Starred');
    assert.equal(byId['copy-message'], 'Copy text');
    assert.equal(byId['ask-ai'], 'Ask Xyne about this');
    assert.equal(byId['forward-message'], 'Forward Message');
    assert.equal(byId['delete'], 'Delete Message');
  });
});

describe('holdMenuLabel', () => {
  it('words the bookmark toggle by its state', () => {
    assert.equal(holdMenuLabel('bookmark', 'Remove Bookmark'), 'Remove from Starred');
    assert.equal(holdMenuLabel('bookmark', 'Add Bookmark'), 'Add to Starred');
  });

  it('calls editing "Edit message"', () => {
    assert.equal(holdMenuLabel('edit-in-chat', 'Edit in Chat'), 'Edit message');
  });
});

describe('holdMenuCopiedNotice', () => {
  it('confirms each copy row and nothing else', () => {
    assert.equal(holdMenuCopiedNotice('copy-message'), 'Copied');
    assert.equal(holdMenuCopiedNotice('copy-link'), 'Link copied');
    assert.equal(holdMenuCopiedNotice('copy-image'), 'Image copied');
    assert.equal(holdMenuCopiedNotice('pin'), null);
  });
});

describe('computeHoldLayout', () => {
  const base = {
    windowHeight: 800,
    insetTop: 50,
    insetBottom: 30,
    showRail: true,
    menuRowCount: 4,
  };
  const minTop = base.insetTop + EDGE;
  const maxBottom = base.windowHeight - base.insetBottom - EDGE;

  it('keeps a mid-screen message where it is', () => {
    const l = computeHoldLayout({ ...base, rect: { y: 300, height: 80 } });
    assert.equal(l.cardTop, 300);
    assert.equal(l.cardShift, 0);
    assert.equal(l.railTop, 300 - HOLD_RAIL_HEIGHT - GAP);
    assert.equal(l.menuTop, 300 + 80 + GAP);
    assert.equal(l.menuHeight, holdMenuNaturalHeight(4));
    assert.equal(l.menuScrolls, false);
  });

  it('pushes the stack up when the menu would run off the bottom', () => {
    const l = computeHoldLayout({ ...base, rect: { y: 650, height: 80 } });
    assert.ok(l.cardShift < 0);
    assert.equal(l.menuTop + l.menuHeight, maxBottom);
  });

  it('pushes the stack down when the rail would run under the status bar', () => {
    const l = computeHoldLayout({ ...base, rect: { y: 20, height: 80 } });
    assert.ok(l.cardShift > 0);
    assert.equal(l.railTop, minTop);
  });

  it('clips a tall message and keeps the menu on screen', () => {
    const l = computeHoldLayout({ ...base, rect: { y: 100, height: 900 } });
    assert.ok(l.cardHeight <= (maxBottom - minTop) * HOLD_MAX_CARD_SHARE + 1e-9);
    assert.ok(l.menuTop + l.menuHeight <= maxBottom + 1e-9);
  });

  it('scrolls a long menu inside the card and still fits', () => {
    const l = computeHoldLayout({ ...base, menuRowCount: 20, rect: { y: 300, height: 80 } });
    assert.equal(l.menuScrolls, true);
    assert.ok(l.menuHeight < holdMenuNaturalHeight(20));
    assert.ok(l.railTop >= minTop - 1e-9);
    assert.ok(l.menuTop + l.menuHeight <= maxBottom + 1e-9);
  });

  it('centres rail and menu when the message could not be measured', () => {
    const l = computeHoldLayout({ ...base, rect: null });
    assert.equal(l.cardHeight, 0);
    assert.equal(l.cardShift, 0);
    const top = l.railTop;
    const bottom = l.menuTop + l.menuHeight;
    assert.ok(Math.abs(top - minTop - (maxBottom - bottom)) < 1e-9);
  });

  it('leaves no rail gap when the rail is hidden', () => {
    const l = computeHoldLayout({ ...base, showRail: false, rect: { y: 300, height: 80 } });
    assert.equal(l.railTop, l.cardTop);
  });
});

describe('hold source store', () => {
  it('serves the latest registered row by conversation id', () => {
    const element = {} as never;
    setHoldSource('a', { content: element, measure: cb => cb(null) });
    assert.ok(getHoldSource('a'));
    assert.equal(getHoldSource('b'), undefined);
    setHoldSource('b', { content: element, measure: cb => cb(null) });
    assert.equal(getHoldSource('a'), undefined);
    clearHoldSource();
    assert.equal(getHoldSource('b'), undefined);
    assert.equal(getHoldSource(undefined), undefined);
  });
});
