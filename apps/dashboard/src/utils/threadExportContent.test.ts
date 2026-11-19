// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createForwardedMessageXml } from '@xyne/shared';
import {
  escapeMarkdown,
  formatThreadMarkdown,
  getThreadExportTitle,
  resolveThreadSenderNames,
  threadMessageToMarkdown,
  type ThreadExportMessage,
} from './threadExport';

const message = (overrides: Partial<ThreadExportMessage> = {}): ThreadExportMessage => ({
  messageId: 'message',
  senderId: 'user',
  content: '<p>Hello <strong>team</strong></p>',
  createdAt: 0,
  isDeleted: false,
  isSent: true,
  attachments: [],
  ...overrides,
});

describe('thread export review regressions', () => {
  it('passes Markdown through unchanged, including links, code, and literal HTML', () => {
    const content = '**bold**\n\n[Link](https://example.com)\n\n```html\n<div>Hello</div>\n```';
    const row = message({ content, metadata: { contentFormat: 'markdown' } });
    expect(threadMessageToMarkdown(row)).toBe(content);
    const exportText = formatThreadMarkdown({
      title: 'Summary',
      channel: 'General',
      url: 'https://example.com',
      messages: [row],
      senderName: () => 'Bot',
    });
    expect(exportText).toContain(content);
    expect(exportText).not.toContain('\\*\\*bold');
  });

  it('still converts HTML and handles null metadata', () => {
    expect(threadMessageToMarkdown(message({ metadata: null }))).toBe('Hello **team**');
    expect(threadMessageToMarkdown(message({ metadata: { contentFormat: 'html' } }))).toBe(
      'Hello **team**',
    );
  });

  it('formats forwarded notes, content, and escaped original sender names', () => {
    const content = createForwardedMessageXml({
      originalMessageId: 'original',
      originalSenderId: 'sender',
      originalSenderName: '[Alice]*',
      originalCreatedAt: 0,
      originalChannelId: 'channel',
      originalConversationId: 'thread',
      optionalText: '<p>FYI</p>',
      content: '<p><strong>Original</strong></p>',
    });
    expect(threadMessageToMarkdown(message({ content }))).toBe(
      'FYI\n\nForwarded from \\[Alice\\]\\*\n\n**Original**',
    );
    expect(escapeMarkdown('[Alice]*')).toBe('\\[Alice\\]\\*');
    const markdownForward = createForwardedMessageXml({
      originalMessageId: 'original',
      originalSenderId: 'sender',
      originalSenderName: 'Alice',
      originalCreatedAt: 0,
      originalChannelId: 'channel',
      originalConversationId: 'thread',
      optionalText: '<p>FYI</p>',
      content: '**Original Markdown**',
    });
    expect(
      threadMessageToMarkdown(
        message({ content: markdownForward, metadata: { contentFormat: 'markdown' } }),
      ),
    ).toBe('FYI\n\nForwarded from Alice\n\n**Original Markdown**');
  });

  it('uses discussion titles, message text, Markdown headings, and channel fallbacks', () => {
    expect(getThreadExportTitle(message(), 'General', 'Explicit title')).toBe('Explicit title');
    expect(getThreadExportTitle(message(), 'General')).toBe('Hello team');
    expect(
      getThreadExportTitle(
        message({ content: '# Release **summary**', metadata: { contentFormat: 'markdown' } }),
        'General',
      ),
    ).toBe('Release summary');
    expect(getThreadExportTitle(message({ content: '<p></p>' }), 'General')).toBe('General');
    expect(getThreadExportTitle(undefined, '')).toBe('Thread');
    expect(getThreadExportTitle(message({ content: 'a'.repeat(150) }), 'General')).toHaveLength(
      100,
    );
  });

  it('resolves missing guests and former members once, and uses UI display-name priority', async () => {
    const lookupUser = vi.fn((id: string) =>
      Promise.resolve(
        id === 'guest'
          ? { name: 'Guest name', displayName: 'Guest display' }
          : { name: 'Former member' },
      ),
    );
    const names = await resolveThreadSenderNames({
      messages: [
        message({ senderId: 'cached' }),
        message({ senderId: 'guest' }),
        message({ senderId: 'guest' }),
        message({ senderId: 'former' }),
        message({ senderId: 'system' }),
        message({ senderId: 'call', metadata: { isCallMessage: true } }),
      ],
      cachedUsers: new Map([['cached', { name: 'Full name', displayName: 'Display name' }]]),
      lookupUser,
      maskEmailForOthers: false,
      selfId: 'cached',
    });
    expect(names.get('cached')).toBe('Display name');
    expect(names.get('guest')).toBe('Guest display');
    expect(names.get('former')).toBe('Former member');
    expect(lookupUser).toHaveBeenCalledTimes(2);
    const result = formatThreadMarkdown({
      title: 'Calls',
      channel: 'General',
      url: 'https://example.com',
      messages: [
        message({ senderId: 'system' }),
        message({ messageId: 'call', senderId: 'system', metadata: { isCallMessage: true } }),
      ],
      senderName: () => 'Unknown',
    });
    expect(result).toContain('## System —');
    expect(result).toContain('## Xyne Call —');
  });

  it('masks email fallback for other community members while preserving self', async () => {
    const lookupUser = vi.fn(() => Promise.resolve({ email: 'private@example.com' }));
    const names = await resolveThreadSenderNames({
      messages: [message({ senderId: 'self' }), message({ senderId: 'other' })],
      cachedUsers: new Map(),
      lookupUser,
      maskEmailForOthers: true,
      selfId: 'self',
    });
    expect(names.get('self')).toBe('private@example.com');
    expect(names.get('other')).toBe('Unknown');
  });
});
