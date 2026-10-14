import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import type { OpenIntent } from '../intent/openIntent.types';
import {
  DRAW_DISTANCE,
  ESTIMATED_ROW_HEIGHT,
  getFixedRowSize,
  legendListProps,
} from '../list/legendListProps';
import { DATE_ROW_HEIGHT, UNREAD_DIVIDER_HEIGHT } from '../model/measureRowHeight';
import type { OpenState } from '../machine/openState';
import type { LandingTarget } from '../machine/openState';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

const mustParse = (raw: Record<string, unknown>): OpenIntent => {
  const result = parseOpenIntent(raw);
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error('parse failed');
  }
  return result.value;
};

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch-1',
  createdAt: DAY,
  messageId: 'm1',
  senderId: 'u2',
  senderDisplayName: 'Ada',
  senderAvatarUri: null,
  messageType: 'USER',
  html: '',
  markdown: 'hello',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: null,
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const intent = mustParse({ channelId: 'ch-1', source: 'tap' });
const surface = intent.surface;
const rows = buildRows(
  [
    input(),
    input({ conversationId: 'c2', createdAt: DAY + 2000, markdown: 'later', messageId: 'm2' }),
  ],
  {
    channelId: 'ch-1',
    channelKind: 'channel',
    currentUserId: 'me',
    unreadBoundaryAt: DAY + 1000,
  },
);

const placing = (target: LandingTarget): OpenState => ({
  status: 'placing',
  intent,
  target,
  source: 'live',
  startedAt: 1,
});

const ready = (target: LandingTarget): OpenState => ({
  status: 'ready',
  intent,
  target,
  source: 'live',
});

const restore = (): boolean => true;

const COMMON = {
  dataKey: 'channel:ch-1',
  alignItemsAtEnd: true,
  recycleItems: true,
  inverted: false,
  extraData: false,
  onStartReachedThreshold: 1.5,
  onEndReachedThreshold: 1.5,
  mvcp: { data: true, size: true },
  estimatedItemSize: ESTIMATED_ROW_HEIGHT,
  drawDistance: DRAW_DISTANCE,
} as const;

const snapshot = (state: OpenState, target: LandingTarget | null) => {
  const props = legendListProps({
    state,
    surface,
    target,
    rows,
    shouldRestorePosition: restore,
  });
  return {
    dataKey: props.dataKey,
    alignItemsAtEnd: props.alignItemsAtEnd,
    recycleItems: props.recycleItems,
    inverted: 'inverted' in props,
    extraData: 'extraData' in props,
    initialScrollAtEnd: props.initialScrollAtEnd,
    initialScrollIndex: props.initialScrollIndex ?? null,
    onStartReachedThreshold: props.onStartReachedThreshold,
    onEndReachedThreshold: props.onEndReachedThreshold,
    mvcp: {
      data: props.maintainVisibleContentPosition.data,
      size: props.maintainVisibleContentPosition.size,
    },
    estimatedItemSize: props.estimatedItemSize,
    drawDistance: props.drawDistance,
  };
};

const unreadIndex = rows.findIndex(row => row.type === 'unread-divider');
const anchorIndex = rows.findIndex(
  row => row.type === 'message' && row.model.conversationId === 'c1',
);

describe('legendListProps', (): void => {
  it('placing × tail uses initialScrollAtEnd and no index', (): void => {
    assert.deepEqual(snapshot(placing({ kind: 'tail' }), { kind: 'tail' }), {
      ...COMMON,
      initialScrollAtEnd: true,
      initialScrollIndex: null,
    });
  });

  it('placing × unread still packs at the last message', (): void => {
    assert.ok(unreadIndex >= 0);
    assert.deepEqual(snapshot(placing({ kind: 'tail' }), { kind: 'tail' }), {
      ...COMMON,
      initialScrollAtEnd: true,
      initialScrollIndex: null,
    });
    assert.equal(
      legendListProps({
        state: placing({ kind: 'tail' }),
        surface,
        target: { kind: 'tail' },
        rows,
        shouldRestorePosition: restore,
      }).maintainScrollAtEnd.on.dataChange,
      true,
    );
  });

  it('placing × anchor lands on the target conversation at viewPosition 0.35', (): void => {
    const target: LandingTarget = {
      kind: 'anchor',
      conversationId: 'c1',
      messageId: 'm1',
      createdAt: DAY,
    };
    assert.ok(anchorIndex >= 0);
    assert.deepEqual(snapshot(placing(target), target), {
      ...COMMON,
      alignItemsAtEnd: false,
      initialScrollAtEnd: false,
      initialScrollIndex: { index: anchorIndex, viewPosition: 0.35 },
    });
  });

  it('ready keeps the same landing props as placing for each kind', (): void => {
    const targets: LandingTarget[] = [
      { kind: 'tail' },
      { kind: 'anchor', conversationId: 'c1', messageId: 'm1', createdAt: DAY },
    ];
    for (const target of targets) {
      assert.deepEqual(snapshot(ready(target), target), snapshot(placing(target), target));
    }
  });

  it('does not pack at end while resolving without a target', (): void => {
    const resolving: OpenState = { status: 'resolving', intent, startedAt: 1 };
    assert.deepEqual(snapshot(resolving, null), {
      ...COMMON,
      alignItemsAtEnd: false,
      initialScrollAtEnd: false,
      initialScrollIndex: null,
    });
  });

  it('uses the library default render-ahead beyond its built-in initial cap', (): void => {
    assert.equal(snapshot(placing({ kind: 'tail' }), { kind: 'tail' }).drawDistance, 250);
    assert.equal(snapshot(ready({ kind: 'tail' }), { kind: 'tail' }).drawDistance, 250);
  });
});

describe('getFixedRowSize', (): void => {
  it('returns a size only for date and unread divider rows', (): void => {
    const date = rows.find(row => row.type === 'date');
    const unread = rows.find(row => row.type === 'unread-divider');
    const message = rows.find(row => row.type === 'message');
    assert.ok(date);
    assert.ok(unread);
    assert.ok(message);
    assert.equal(getFixedRowSize(date), DATE_ROW_HEIGHT);
    assert.equal(getFixedRowSize(unread), UNREAD_DIVIDER_HEIGHT);
    assert.equal(getFixedRowSize(message), undefined);
  });
});

describe('v3/list list-engine rules', (): void => {
  it('does not pass inverted or extraData as props', (): void => {
    const dir = join(fileURLToPath(new URL('../list', import.meta.url)));
    const files = readdirSync(dir).filter(name => name.endsWith('.ts') || name.endsWith('.tsx'));
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      assert.equal(/inverted=\{/.test(source), false, name);
      assert.equal(/extraData=\{/.test(source), false, name);
      assert.equal(/paddingBottom/.test(source), false, name);
      assert.equal(/opacity:\s*0/.test(source), false, name);
      assert.equal(/display:\s*['"]none['"]/.test(source), false, name);
    }
  });
});
