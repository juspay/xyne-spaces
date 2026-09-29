import type { LoadProgress } from './types';

export function formatClock(ts: number): string {
  const t = new Date(ts);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

export interface UpdateActivity {
  mode: 'full' | 'sync';
  /** Sync only: changes are looked for since this time. */
  since: number | null;
}

/** One line for the update bar: what the running load or sync is doing. */
export function updateBarText(a: UpdateActivity, p: LoadProgress): string {
  const sources = `${p.projectsDone + p.desksDone}/${p.projectsTotal + p.desksTotal} sources`;
  if (a.mode === 'sync') {
    const since = a.since !== null ? ` since ${formatClock(a.since)}` : '';
    const allRead = p.projectsTotal + p.desksTotal > 0 && p.projectsDone + p.desksDone === p.projectsTotal + p.desksTotal;
    if (p.phase === 'tickets' && allRead) return 'Updating changed tickets…';
    if (p.phase === 'tickets') return `Checking for changes${since} · ${sources}`;
    if (p.phase === 'linking' || p.phase === 'done') return 'Linking new and updated tickets…';
    return `Checking for changes${since}…`;
  }
  if (p.phase === 'tickets') return `Loading all tickets · ${sources}`;
  if (p.phase === 'linking' || p.phase === 'done') return 'Linking sub-tickets…';
  return 'Loading all tickets…';
}

export function updateSummaryText(r: { added: number; updated: number }): string {
  const parts = [r.added > 0 ? `${r.added} new` : '', r.updated > 0 ? `${r.updated} updated` : ''].filter(Boolean);
  return parts.length > 0 ? `Up to date · ${parts.join(', ')}` : 'Up to date';
}
