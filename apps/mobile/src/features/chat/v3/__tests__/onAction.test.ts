import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createForwardedMessageXml } from '@xyne/shared';

import { onAction, type OnActionDeps } from '../overlays/onAction';
import { channelHtmlToPlainText } from '../model/messageCopy';

const target = {
  messageId: 'm1',
  conversationId: 'c1',
  channelId: 'ch',
  html: '<p>hi</p>',
  isForwarded: false,
  isBookmarked: false,
};

const deps = (over: Partial<OnActionDeps> = {}): OnActionDeps => ({
  zero: { mutate: (): void => undefined } as never,
  createId: (): string => 'id-1',
  now: (): number => 1,
  retryPending: (): void => undefined,
  deletePending: (): void => undefined,
  pushThread: (): void => undefined,
  copyText: (): void => undefined,
  copyLink: (): void => undefined,
  copyImage: (): void => undefined,
  startCall: (): void => undefined,
  confirmDelete: (onConfirm: () => void): void => onConfirm(),
  fail: (): void => undefined,
  ...over,
});

describe('onAction', (): void => {
  it('pins the conversation', (): void => {
    const calls: unknown[] = [];
    onAction(
      deps({
        zero: {
          mutate: (payload: unknown): void => {
            calls.push(payload);
          },
        } as never,
      }),
      'pin',
      target,
      false,
    );
    assert.equal(calls.length, 1);
  });

  it('copies plain text and original rich HTML, and skips an empty body', (): void => {
    const copied: { plain: string; html: string }[] = [];
    onAction(
      deps({
        copyText: (plain, html): void => {
          copied.push({ plain, html });
        },
      }),
      'copy-message',
      { ...target, html: '<p><strong>hi</strong><br>there</p>' },
      false,
    );
    onAction(
      deps({
        copyText: (plain, html): void => {
          copied.push({ plain, html });
        },
      }),
      'copy-message',
      { ...target, html: '<p> </p>' },
      false,
    );
    assert.deepEqual(copied, [{ plain: 'hi\nthere', html: '<p><strong>hi</strong><br>there</p>' }]);
  });

  it('uses channel HTML semantics for channel copy and composer semantics for threads', (): void => {
    assert.equal(
      channelHtmlToPlainText(
        '<p>Hello&nbsp;&amp;&nbsp;world</p><p><img data-emoji="true" alt=":wave:"></p>',
      ),
      'Hello & world\n:wave:',
    );

    const copied: string[] = [];
    const html = '<pre>Hello</pre><pre>world</pre>';
    onAction(
      deps({ copyText: plain => copied.push(plain) }),
      'copy-message',
      { ...target, html },
      false,
    );
    onAction(
      deps({ copyText: plain => copied.push(plain) }),
      'copy-message',
      { ...target, html },
      true,
    );
    assert.deepEqual(copied, ['Helloworld', 'Hello\nworld']);
  });

  it('opens a thread and asks before delete', (): void => {
    const threads: string[] = [];
    let confirmed = false;
    onAction(
      deps({
        pushThread: (_channelId, conversationId): void => {
          threads.push(conversationId);
        },
      }),
      'reply-in-thread',
      target,
      false,
    );
    onAction(
      deps({
        confirmDelete: (onConfirm): void => {
          confirmed = true;
          onConfirm();
        },
      }),
      'delete',
      target,
      false,
    );
    assert.deepEqual(threads, ['c1']);
    assert.equal(confirmed, true);
  });

  it('passes stored composer HTML to edit-in-chat', (): void => {
    const edits: string[] = [];
    onAction(
      deps({
        onEditInChat: payload => {
          edits.push(payload.content);
        },
      }),
      'edit-in-chat',
      { ...target, html: '<p>Hello <mention data-id="u1">@Ada</mention></p>' },
      false,
    );
    assert.deepEqual(edits, ['<p>Hello <mention data-id="u1">@Ada</mention></p>']);
  });

  it('passes only the optional comment when editing a forwarded message', (): void => {
    const edits: string[] = [];
    const wrapper = createForwardedMessageXml({
      originalMessageId: 'original-1',
      originalSenderId: 'original-user',
      originalSenderName: 'Original User',
      originalCreatedAt: Date.UTC(2026, 7, 22, 11, 0, 0),
      originalChannelId: 'original-channel',
      originalConversationId: 'original-conversation',
      optionalText: 'See this',
      content: '<p>Original body</p>',
    });
    onAction(
      deps({
        onEditInChat: payload => {
          edits.push(payload.content);
        },
      }),
      'edit-in-chat',
      { ...target, html: wrapper },
      false,
    );
    assert.deepEqual(edits, ['See this']);
  });

  it('clears the edit payload when a forwarded message has no optional comment', (): void => {
    const edits: string[] = [];
    const wrapper = createForwardedMessageXml({
      originalMessageId: 'original-1',
      originalSenderId: 'original-user',
      originalSenderName: 'Original User',
      originalCreatedAt: Date.UTC(2026, 7, 22, 11, 0, 0),
      originalChannelId: 'original-channel',
      originalConversationId: 'original-conversation',
      optionalText: null,
      content: '<p>Original body</p>',
    });
    onAction(
      deps({
        onEditInChat: payload => {
          edits.push(payload.content);
        },
      }),
      'edit-in-chat',
      { ...target, html: wrapper, isForwarded: true },
      false,
    );
    assert.deepEqual(edits, ['']);
  });

  it('skips the leave viewed flush after mark-as-unread', (): void => {
    let before = 0;
    onAction(
      deps({
        onBeforeMarkUnread: (): void => {
          before += 1;
        },
      }),
      'mark-as-unread',
      target,
      false,
    );
    assert.equal(before, 1);
  });

  it('reports synchronous send-to-channel mutation failures', (): void => {
    const failures: string[] = [];
    onAction(
      deps({
        zero: {
          mutate: (): never => {
            throw new Error('mutation failed');
          },
        } as never,
        fail: title => {
          failures.push(title);
        },
      }),
      'send-to-channel',
      target,
      true,
    );
    assert.deepEqual(failures, ['Failed to send to channel']);
  });

  it('reports synchronous mark-as-unread mutation failures', (): void => {
    const failures: string[] = [];
    let before = 0;
    onAction(
      deps({
        zero: {
          mutate: (): never => {
            throw new Error('mutation failed');
          },
        } as never,
        onBeforeMarkUnread: (): void => {
          before += 1;
        },
        fail: title => {
          failures.push(title);
        },
      }),
      'mark-as-unread',
      target,
      false,
    );
    assert.equal(before, 1);
    assert.deepEqual(failures, ['Error']);
  });

  it('reports synchronous delete mutation failures after confirmation', (): void => {
    const failures: string[] = [];
    onAction(
      deps({
        zero: {
          mutate: (): never => {
            throw new Error('mutation failed');
          },
        } as never,
        fail: title => {
          failures.push(title);
        },
      }),
      'delete',
      target,
      false,
    );
    assert.deepEqual(failures, ['Failed to delete message']);
  });
});

describe('MessageActionsHost', (): void => {
  it('is driven by actionVisibility and does not import v2', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../overlays/MessageActionsHost.tsx', import.meta.url)),
      'utf8',
    );
    const actionTarget = readFileSync(
      fileURLToPath(new URL('../overlays/actionTarget.ts', import.meta.url)),
      'utf8',
    );
    assert.equal(/actionVisibility/.test(source), true);
    assert.equal(/actionFlagsFor/.test(source), true);
    assert.equal(/QuickReactionsRail/.test(source), true);
    assert.equal(/features\/chat\/v2/.test(source), false);
    assert.equal(/extraData=/.test(source), false);
    assert.equal(/row\.model\.storedHtml/.test(actionTarget), true);
  });

  it('does not render a forward action without an opener', (): void => {
    const source = readFileSync(
      fileURLToPath(new URL('../overlays/MessageActionsHost.tsx', import.meta.url)),
      'utf8',
    );
    assert.match(source, /id !== 'forward-message' \|\| onForward/);
    assert.match(source, /ACTION_ORDER\.filter\(id => renderableActions\.has\(id\)\)/);
  });
});
