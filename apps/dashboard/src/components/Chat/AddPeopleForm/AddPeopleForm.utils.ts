import { historyScopeToCutoff, type HistoryScope, type HistoryScopeMode } from '@xyne/shared';
import { htmlToPlainText } from '../../../utils/sanitizer';
import type { HistoryScopeOption } from './AddPeopleForm.types';

export function toPreviewText(content?: string | null): string {
  if (!content) {
    return '';
  }
  return htmlToPlainText(content);
}

export const HISTORY_SCOPE_OPTIONS: HistoryScopeOption[] = [
  { mode: 'none', label: "Don't include any conversation history" },
  { mode: 'today', label: 'From today' },
  { mode: 'beginning', label: 'From the beginning' },
  { mode: 'custom', label: 'Custom', requiresDate: true },
];

export function buildHistoryScope(mode: HistoryScopeMode, customDate: string): HistoryScope {
  switch (mode) {
    case 'none':
      return { mode: 'none' };
    case 'today':
      return { mode: 'today' };
    case 'beginning':
      return { mode: 'beginning' };
    case 'custom': {
      const parsed = customDate ? new Date(customDate) : null;
      const isValid = parsed !== null && !Number.isNaN(parsed.getTime());
      return { mode: 'custom', from: isValid ? parsed.toISOString() : '' };
    }
  }
}

export function previewLowerBound(scope: HistoryScope): number | null {
  const cutoff = historyScopeToCutoff(scope, new Date());
  if (!cutoff || Number.isNaN(cutoff.getTime())) {
    return null;
  }
  return cutoff.getTime();
}

export function hasChosenCutoff(mode: HistoryScopeMode, customDate: string): boolean {
  return mode !== 'custom' || Boolean(customDate);
}

export function isScopeValid(mode: HistoryScopeMode, customDate: string): boolean {
  if (!hasChosenCutoff(mode, customDate)) {
    return false;
  }
  if (mode !== 'custom') {
    return true;
  }
  const parsed = Date.parse(customDate);
  return !Number.isNaN(parsed) && parsed <= Date.now();
}

export const ADD_PEOPLE_TITLES = {
  peopleDirect: 'Add people to this conversation',
  peopleChannel: 'Add Members',
  history: 'Include conversation history?',
  historyExisting: 'Add history to this conversation?',
} as const;

export function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function ordinalSuffix(day: number): string {
  if (day > 3 && day < 21) {
    return 'th';
  }
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function formatDayDivider(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const day = date.getDate();
  return `${month} ${day}${ordinalSuffix(day)}, ${date.getFullYear()}`;
}

export function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function groupByDay<T extends { createdAt: number }>(
  items: readonly T[],
): Array<{ key: string; label: string; items: T[] }> {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];

  for (const item of items) {
    const key = dayKey(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    groups.push({ key, label: formatDayDivider(item.createdAt), items: [item] });
  }

  return groups;
}
