import { logger, Event as LogEvent } from './logger';

const RECENT_LABELS_STORAGE_KEY = 'xyne_recent_labels';
const RECENT_LABELS_LIMIT = 20;

const readBoardRecentLabels = (userId: string, boardId: string): string[] => {
  try {
    return JSON.parse(
      localStorage.getItem(`${RECENT_LABELS_STORAGE_KEY}:${userId}:${boardId}`) ?? '[]',
    ) as string[];
  } catch {
    return [];
  }
};

export function loadRecentLabels(userId: string, boardIds: string[]): string[] {
  const rank = new Map<string, number>();
  boardIds.forEach(boardId => {
    readBoardRecentLabels(userId, boardId).forEach((tag, index) => {
      rank.set(tag, Math.min(index, rank.get(tag) ?? index));
    });
  });
  return [...rank.keys()]
    .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    .slice(0, RECENT_LABELS_LIMIT);
}

export function saveRecentLabels(userId: string, boardId: string, tags: string[]): void {
  try {
    const recent = [...new Set([...tags, ...readBoardRecentLabels(userId, boardId)])];
    localStorage.setItem(
      `${RECENT_LABELS_STORAGE_KEY}:${userId}:${boardId}`,
      JSON.stringify(recent.slice(0, RECENT_LABELS_LIMIT)),
    );
  } catch (error) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'recent_labels_save_failed',
      message: 'Failed to save recent labels',
      error: error,
    });
  }
}

export function sortByRecency(tags: string[], recent: string[]): string[] {
  const rank = new Map(recent.map((tag, index) => [tag, index]));
  return [...tags].sort((a, b) => (rank.get(a) ?? recent.length) - (rank.get(b) ?? recent.length));
}
