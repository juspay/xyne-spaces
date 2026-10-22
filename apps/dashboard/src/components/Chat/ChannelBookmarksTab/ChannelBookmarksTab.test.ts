import { describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '@xyne/shared';

vi.mock('../BookmarkItem/BookmarkItem', () => ({ BookmarkItem: () => null }));
vi.mock('../../../hooks/useCachedQuery', () => ({ useCachedQuery: () => [[], { type: 'complete' }] }));
vi.mock('../../../zero/queries', () => ({ queries: {} }));
vi.mock('../../ui/DelayedSpinner', () => ({ DelayedSpinner: () => null }));
vi.mock('../../../hooks/usePlatform', () => ({ usePlatform: () => ({ isMobile: false }) }));

const { sortChannelBookmarks } = await import('./ChannelBookmarksTab');

const NOW = Date.UTC(2026, 9, 22, 12);
const bm = (id: string, createdAt: number, remindAt?: number): Bookmark =>
  ({
    id,
    createdAt,
    metadata: remindAt ? { reminder: { enabled: true, remindAt: new Date(remindAt).toISOString() } } : null,
  }) as unknown as Bookmark;

describe('sortChannelBookmarks', () => {
  it('puts overdue reminders first, then upcoming (soonest first), then newest plain bookmarks', () => {
    const sorted = sortChannelBookmarks(
      [
        bm('plain-old', NOW - 10_000),
        bm('upcoming-late', NOW - 5, NOW + 60_000),
        bm('plain-new', NOW - 1),
        bm('overdue', NOW - 20_000, NOW - 1_000),
        bm('upcoming-soon', NOW - 6, NOW + 1_000),
      ],
      NOW,
    ).map(b => b.id);
    expect(sorted).toEqual(['overdue', 'upcoming-soon', 'upcoming-late', 'plain-new', 'plain-old']);
  });

  it('does not mutate the input array', () => {
    const input = [bm('a', 1), bm('b', 2)];
    sortChannelBookmarks(input, NOW);
    expect(input.map(b => b.id)).toEqual(['a', 'b']);
  });
});
