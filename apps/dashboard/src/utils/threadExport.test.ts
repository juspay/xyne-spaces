import { describe, expect, it } from 'vitest';
import { formatThreadMarkdown, type ThreadExportMessage } from './threadExport';

const message = (messageId: string, createdAt: number): ThreadExportMessage => ({
  messageId,
  createdAt,
  senderId: 'user',
  content: 'Hello',
  isDeleted: false,
  isSent: true,
  attachments: [],
});
const format = (messages: ThreadExportMessage[]): string =>
  formatThreadMarkdown({
    title: 'A thread',
    channel: 'General',
    url: 'https://example.com/thread',
    messages,
    senderName: () => 'Alice',
    convertContent: value => value,
  });

describe('thread Markdown export', () => {
  it('orders and deduplicates confirmed messages, excluding deleted and pending rows', () => {
    const first = message('first', 0);
    const second = { ...message('second', 1000), content: 'Reply' };
    const result = format([
      second,
      first,
      first,
      { ...message('deleted', 2000), isDeleted: true, content: 'Deleted' },
      { ...message('pending', 3000), isSent: false, content: 'Pending' },
    ]);
    expect(result.indexOf('Hello')).toBeLessThan(result.indexOf('Reply'));
    expect(result.match(/Hello/g)).toHaveLength(1);
    expect(result).not.toContain('Deleted');
    expect(result).not.toContain('Pending');
    expect(result).toContain('Alice — 1970-01-01T00:00:00.000Z');
    expect(result).toContain('[Open thread](<https://example.com/thread>)');
  });

  it('exports attachment links, escapes labels, and excludes deleted attachments', () => {
    const result = format([
      {
        ...message('first', 0),
        attachments: [
          { originalFilename: '[notes].txt', url: '/notes', isDeleted: false },
          { originalFilename: 'deleted.txt', url: '/deleted', isDeleted: true },
          { originalFilename: 'unsafe.txt', url: 'javascript:alert(1)', isDeleted: false },
        ],
      },
    ]);
    expect(result).toContain('[\\[notes\\].txt](<https://example.com/notes>)');
    expect(result).not.toContain('deleted.txt');
    expect(result).not.toContain('javascript:');
  });
});
