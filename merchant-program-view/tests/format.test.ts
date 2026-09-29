import { describe, expect, it } from 'vitest';
import { updateBarText, updateSummaryText } from '../lib/format';

describe('update bar text', () => {
  const since = new Date(2026, 8, 29, 13, 2).getTime();
  const p = (phase: 'boot' | 'tickets' | 'linking' | 'done') => ({ phase, projectsDone: 40, projectsTotal: 136, desksDone: 2, desksTotal: 19 });

  it('describes a sync by what it checks, not what it reloads', () => {
    expect(updateBarText({ mode: 'sync', since }, p('boot'))).toBe('Checking for changes since 13:02…');
    expect(updateBarText({ mode: 'sync', since }, p('tickets'))).toBe('Checking for changes since 13:02 · 42/155 sources');
    expect(updateBarText({ mode: 'sync', since }, p('linking'))).toBe('Linking new and updated tickets…');
  });

  it('says when every source is read and changed tickets are being re-read', () => {
    const all = { phase: 'tickets' as const, projectsDone: 136, projectsTotal: 136, desksDone: 19, desksTotal: 19 };
    expect(updateBarText({ mode: 'sync', since }, all)).toBe('Updating changed tickets…');
  });

  it('describes a full load', () => {
    expect(updateBarText({ mode: 'full', since: null }, p('boot'))).toBe('Loading all tickets…');
    expect(updateBarText({ mode: 'full', since: null }, p('tickets'))).toBe('Loading all tickets · 42/155 sources');
    expect(updateBarText({ mode: 'full', since: null }, p('linking'))).toBe('Linking sub-tickets…');
  });

  it('summarises the result', () => {
    expect(updateSummaryText({ added: 0, updated: 0 })).toBe('Up to date');
    expect(updateSummaryText({ added: 3, updated: 5 })).toBe('Up to date · 3 new, 5 updated');
    expect(updateSummaryText({ added: 1, updated: 0 })).toBe('Up to date · 1 new');
    expect(updateSummaryText({ added: 0, updated: 2 })).toBe('Up to date · 2 updated');
  });
});
