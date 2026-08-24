import { historyScopeToCutoff, type HistoryScope, type HistoryScopeMode } from '@xyne/shared';
import { htmlToPlainText } from '../../../utils/sanitizer';
import { formatDatePill } from '../../../utils/dateUtils';
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

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseInputDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildHistoryScope(mode: HistoryScopeMode, customDate: string): HistoryScope {
  switch (mode) {
    case 'none':
      return { mode: 'none' };
    case 'beginning':
      return { mode: 'beginning' };
    case 'today':
      return { mode: 'today', from: startOfLocalDay(new Date()).toISOString() };
    case 'custom': {
      const parsed = customDate ? parseInputDate(customDate) : null;
      return { mode: 'custom', from: parsed ? parsed.toISOString() : '' };
    }
  }
}

export function previewLowerBound(scope: HistoryScope): number | null {
  const cutoff = historyScopeToCutoff(scope);
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
} as const;

export function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
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
    groups.push({ key, label: formatDatePill(item.createdAt), items: [item] });
  }

  return groups;
}
