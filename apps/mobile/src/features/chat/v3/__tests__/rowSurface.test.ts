import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';
import { rowsAreEqual } from '../model/rowEquals';
import { getRowType, rowSurface } from '../model/rowType';
import type { ChatRow } from '../model/chatRow.types';

const DAY = Date.UTC(2026, 7, 22, 12, 0, 0);

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'c1',
  channelId: 'ch',
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

const ctx = {
  channelId: 'ch',
  channelKind: 'channel' as const,
  currentUserId: 'me',
  unreadBoundaryAt: DAY + 500,
};

describe('rowSurface', (): void => {
  it('routes date, unread, system, and message rows', (): void => {
    const rows = buildRows(
      [
        input({ conversationId: 'c1', createdAt: DAY }),
        input({
          conversationId: 'c2',
          createdAt: DAY + 1000,
          messageType: 'SYSTEM',
          markdown: 'joined',
        }),
        input({
          conversationId: 'c3',
          createdAt: DAY + 1500,
          markdown: 'after join',
        }),
      ],
      ctx,
    );
    const surfaces = rows.map(rowSurface);
    assert.equal(surfaces.includes('date'), true);
    assert.equal(surfaces.includes('unread-divider'), true);
    assert.equal(surfaces.includes('system'), true);
    assert.equal(surfaces.includes('message'), true);
  });

  it('paints flow-json SYSTEM in the centered system surface', (): void => {
    const rows = buildRows(
      [
        input({
          conversationId: 'c2',
          messageType: 'SYSTEM',
          isFlowJson: true,
          markdown: '{"flow":true}',
        }),
      ],
      { channelId: 'ch', channelKind: 'channel', currentUserId: 'me' },
    );
    const message = rows.find(row => row.type === 'message');
    assert.ok(message && message.type === 'message');
    assert.equal(rowSurface(message), 'system');
    assert.equal(getRowType(message), 'system-flow');
    assert.equal(message.model.showAvatar, false);
    assert.equal(message.model.showSenderName, false);
  });

  it('keeps every regular system message on the centered system surface', (): void => {
    const rows = buildRows(
      [
        input({
          conversationId: 'system-pill',
          messageType: 'SYSTEM',
          markdown: 'joined',
        }),
        input({
          conversationId: 'system-message',
          createdAt: DAY + 1000,
          messageType: 'SYSTEM',
          markdown: 'long system message '.repeat(200),
        }),
      ],
      { channelId: 'ch', channelKind: 'channel', currentUserId: 'me' },
    );
    const systemRows = rows.filter(
      (row): row is Extract<ChatRow, { type: 'message' }> => row.type === 'message',
    );
    assert.equal(rowSurface(systemRows[0]!), 'system');
    assert.equal(getRowType(systemRows[0]!), 'system');
    assert.equal(rowSurface(systemRows[1]!), 'system');
    assert.equal(getRowType(systemRows[1]!), 'system');
    assert.equal(systemRows[0]?.model.showSenderName, false);
    assert.equal(systemRows[0]?.model.showAvatar, false);
    assert.equal(systemRows[1]?.model.showSenderName, false);
    assert.equal(systemRows[1]?.model.showAvatar, false);
  });

  it('routes call messages to their dedicated card surface and pool', (): void => {
    const rows = buildRows(
      [
        input({
          messageType: 'SYSTEM',
          metadata: {
            isCallMessage: true,
            callId: 'call-1',
          },
        }),
      ],
      { channelId: 'ch', channelKind: 'channel', currentUserId: 'me' },
    );
    const call = rows.find(row => row.type === 'message');
    assert.ok(call && call.type === 'message');
    assert.equal(rowSurface(call), 'call');
    assert.equal(getRowType(call), 'call');
  });
});

describe('rowsAreEqual', (): void => {
  it('treats grouping flag flips as a paint change', (): void => {
    const withoutUnreadBoundary = {
      channelId: ctx.channelId,
      channelKind: ctx.channelKind,
      currentUserId: ctx.currentUserId,
    };
    const first = buildRows([input()], withoutUnreadBoundary);
    const message = (rows: ChatRow[]): Extract<ChatRow, { type: 'message' }> =>
      rows.find(row => row.type === 'message') as Extract<ChatRow, { type: 'message' }>;
    const a = message(first);
    const b = {
      ...a,
      model: { ...a.model, showAvatar: !a.model.showAvatar },
    };
    assert.equal(rowsAreEqual(a, b), false);
  });

  it('treats the same contentSignature as equal and a body change as not', (): void => {
    const withoutUnreadBoundary = {
      channelId: ctx.channelId,
      channelKind: ctx.channelKind,
      currentUserId: ctx.currentUserId,
    };
    const first = buildRows([input()], withoutUnreadBoundary);
    const same = buildRows([input()], withoutUnreadBoundary);
    const changed = buildRows([input({ markdown: 'later' })], {
      ...withoutUnreadBoundary,
    });
    const message = (rows: ChatRow[]): ChatRow => rows.find(row => row.type === 'message')!;
    assert.equal(rowsAreEqual(message(first), message(same)), true);
    assert.equal(rowsAreEqual(message(first), message(changed)), false);
  });

  it('invalidates a reused row when sender ownership changes', (): void => {
    const context = {
      channelId: ctx.channelId,
      channelKind: ctx.channelKind,
      currentUserId: ctx.currentUserId,
    };
    const other = buildRows([input({ senderId: 'u2' })], context);
    const current = buildRows([input({ senderId: 'me' })], context);
    const message = (rows: ChatRow[]): ChatRow => rows.find(row => row.type === 'message')!;
    assert.equal(rowsAreEqual(message(other), message(current)), false);
  });

  it('preserves stored composer HTML and invalidates rich-content changes', (): void => {
    const context = {
      channelId: ctx.channelId,
      channelKind: ctx.channelKind,
      currentUserId: ctx.currentUserId,
      unreadCount: 0,
    };
    const first = buildRows(
      [input({ markdown: '**hello**', html: '<p><strong>hello</strong></p>' })],
      context,
    );
    const changed = buildRows(
      [input({ markdown: '**hello**', html: '<p><b>hello</b></p>' })],
      context,
    );
    const message = (rows: ChatRow[]): Extract<ChatRow, { type: 'message' }> =>
      rows.find(row => row.type === 'message') as Extract<ChatRow, { type: 'message' }>;
    assert.equal(message(first).model.storedHtml, '<p><strong>hello</strong></p>');
    assert.equal(rowsAreEqual(message(first), message(changed)), false);
  });
});

describe('v3/rows recycle rules', (): void => {
  it('does not use plain useState or extraData', (): void => {
    const dir = join(fileURLToPath(new URL('../rows', import.meta.url)));
    const walk = (root: string): string[] =>
      readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
          return walk(path);
        }
        return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [];
      });
    for (const path of walk(dir)) {
      if (path.endsWith('useRecyclingState.ts')) {
        continue;
      }
      const source = readFileSync(path, 'utf8');
      assert.equal(/useState\s*[<(]/.test(source), false, path);
      assert.equal(/extraData=\{/.test(source), false, path);
    }
  });
});
