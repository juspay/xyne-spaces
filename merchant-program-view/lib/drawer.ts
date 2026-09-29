import { fmtDays, type Flag } from './flags';
import type { FTicket } from './portfolio';
import type { Court, Model, Pri, St } from './model';

/** The ticket drawer: header, flags, timing, stage history, details, linked tickets and activity. */

export interface ActivityRow {
  id: string;
  ticketId: string;
  activityType: string;
  value: unknown;
  timestamp: number;
}

export interface Timing {
  k: string;
  v: string;
  sub: string;
  tone: 'default' | 'red' | 'amber' | 'age';
}

export interface LinkRow {
  id: string;
  key: string;
  title: string;
  rel: 'parent' | 'sub-ticket';
  stage: string;
  st: St;
  pri: Pri;
  who: string;
  age: string;
  open: boolean;
  d: number;
}

export interface Drawer {
  id: string;
  kind: 'Desk' | 'Board';
  key: string;
  title: string;
  src: string;
  status: string;
  st: St;
  stage: string;
  pri: Pri;
  priLabel: string;
  who: string;
  url: string;
  midR: string[];
  flags: Flag[];
  timing: Timing[];
  /** Oldest first; an `earlier` row stands in for stages cut off or beyond the last few. */
  history: { name: string; days: string; current: boolean; earlier?: boolean }[];
  fields: { k: string; v: string }[];
  links: LinkRow[];
  activity: { text: string; when: string }[];
}

export const STATUS_LABEL: Record<St, string> = { todo: 'To do', started: 'In progress', paused: 'Paused', completed: 'Done', cancelled: 'Cancelled' };
export const PRI_LABEL: Record<Pri, string> = { critical: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' };
const COURT_LABEL: Record<Court, string> = { us: 'Us', merchant: 'Merchant', external: 'External (bank / partner)' };

const DAY = 86_400_000;
const HISTORY_MAX = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);

interface StageValue {
  field?: string;
  oldValue?: string;
  newValue?: string;
  stageName?: string;
  subTicketXyneId?: string;
  sourceTicketXyneId?: string;
}
const val = (a: ActivityRow): StageValue => (a.value && typeof a.value === 'object' ? (a.value as StageValue) : {});
const isStageChange = (a: ActivityRow): boolean => (a.activityType === 'STATUS' || a.activityType === 'STAGE_NAME') && val(a).field === 'stageName';

function activityText(a: ActivityRow, users: Map<string, string>): string | null {
  const v = val(a);
  switch (a.activityType) {
    case 'TICKET_CREATED':
      return v.stageName ? `Created in ${v.stageName}` : 'Created';
    case 'STATUS':
    case 'STAGE_NAME':
      if (v.field === 'stageName') return `Moved to ${v.newValue}`;
      if (v.field === 'statusV2') return `Status ${String(v.oldValue ?? '').toLowerCase()} → ${String(v.newValue ?? '').toLowerCase()}`;
      return null;
    case 'ASSIGNED_TO':
      return v.newValue ? `Assigned to ${users.get(v.newValue) ?? 'someone'}` : 'Unassigned';
    case 'SUBTICKET_CREATED':
      return `Sub-ticket ${v.subTicketXyneId ?? ''} created`.replace('  ', ' ');
    case 'SUBTICKET_LINKED':
      return 'Sub-ticket linked';
    case 'EMAIL_SENT':
      return 'Reply sent to the merchant';
    case 'PRIORITY':
      return v.newValue ? `Priority set to ${String(v.newValue).toLowerCase()}` : null;
    case 'MERGED':
      return v.sourceTicketXyneId ? `Merged ${v.sourceTicketXyneId} into this ticket` : 'Merged a ticket';
    default:
      return null;
  }
}

export function drawer(
  m: Model,
  byId: Map<string, FTicket>,
  id: string,
  /** null while loading; 'failed' when the fetch failed. */
  activities: ActivityRow[] | null | 'failed',
  users: Map<string, string>,
  now: number = m.now,
): Drawer {
  const t = byId.get(id)!;
  const failed = activities === 'failed';
  const asc = Array.isArray(activities) ? [...activities].sort((a, b) => a.timestamp - b.timestamp) : null;
  const changes = asc ? asc.filter(isStageChange) : [];
  const lastChange = changes.at(-1);
  const created = asc?.find(a => a.activityType === 'TICKET_CREATED');
  // The fetch returns only the newest rows. With no stage change and no creation row among them,
  // the stage started before the oldest row we have: a lower bound, not the ticket's age.
  const cutOff = asc !== null && !lastChange && !created && asc.length > 0;
  const inStage = asc ? (now - (lastChange?.timestamp ?? (cutOff ? asc[0].timestamp : t.createdAt))) / DAY : null;
  const inStageText = inStage === null ? (failed ? '—' : '…') : cutOff ? `over ${fmtDays(inStage)}` : fmtDays(inStage);

  const timing: Timing[] = [
    { k: 'Age', v: fmtDays(t.d), sub: t.open ? 'since created' : `closed ${fmtDays(t.closedD ?? 0)} ago`, tone: t.open ? 'age' : 'default' },
    {
      k: 'In current stage',
      v: inStageText,
      sub: t.stageOverdue && t.open ? 'past its stage ETA' : 'within stage ETA or none set',
      tone: t.stageOverdue && t.open ? 'red' : 'default',
    },
    {
      k: 'Ticket ETA',
      v: t.eta == null ? '—' : t.eta < 0 ? `${fmtDays(-t.eta)} over` : `in ${fmtDays(t.eta)}`,
      sub: t.eta == null ? 'not set' : t.eta < 0 && t.open ? 'breached' : 'on track',
      tone: t.eta != null && t.eta < 0 && t.open ? 'red' : 'default',
    },
    {
      k: 'Last update',
      v: ago(t.u),
      sub: t.open ? `waiting on ${COURT_LABEL[t.court].toLowerCase()}` : '—',
      tone: t.flags.some(f => f.type === 'stale') ? 'amber' : 'default',
    },
  ];

  let history: Drawer['history'];
  if (!asc) {
    history = [{ name: t.stage, days: 'now', current: true }];
  } else if (changes.length === 0) {
    const cur = { name: t.stage, days: `${inStageText} · now`, current: true };
    history = cutOff ? [{ name: 'Earlier stages', days: '', current: false, earlier: true }, cur] : [cur];
  } else {
    // Without the creation row the activity page was cut off, so the first stage's start is unknown.
    const stops = [
      ...(created ? [{ name: val(created).stageName ?? val(changes[0]).oldValue ?? '—', at: t.createdAt }] : []),
      ...changes.map(c => ({ name: val(c).newValue ?? '—', at: c.timestamp })),
    ];
    const skip = Math.max(0, stops.length - HISTORY_MAX);
    history = stops.slice(skip).map((s, j) => {
      const i = skip + j;
      const current = i === stops.length - 1;
      const end = current ? now : stops[i + 1].at;
      const dur = fmtDays((end - s.at) / DAY);
      return { name: s.name, days: current ? (t.open ? `${dur} · now` : `closed ${fmtDays(t.closedD ?? 0)} ago`) : dur, current };
    });
    if (!created || skip > 0) history.unshift({ name: 'Earlier stages', days: '', current: false, earlier: true });
  }

  const link = (x: FTicket, rel: LinkRow['rel']): LinkRow => ({
    id: x.id,
    key: x.key,
    title: x.title,
    rel,
    stage: x.stage,
    st: x.st,
    pri: x.pri,
    who: x.who ?? 'Unassigned',
    age: x.open ? fmtDays(x.d) : 'done',
    open: x.open,
    d: x.d,
  });
  const links: LinkRow[] = [];
  if (t.parent && byId.has(t.parent)) links.push(link(byId.get(t.parent)!, 'parent'));
  for (const k of t.kids) if (byId.has(k)) links.push(link(byId.get(k)!, 'sub-ticket'));

  const fields = [
    { k: 'Merchant ID', v: t.mids.length ? t.mids.join(', ') : `no MID · inherits ${t.midR.join(', ') || '—'}` },
    { k: 'Source', v: t.src },
    ...(t.reporter ? [{ k: 'Reporter', v: t.reporter }] : []),
    { k: 'Created', v: `${dateOf(t.createdAt)} · ${ago(t.d)}` },
    ...(t.closedD != null ? [{ k: 'Closed', v: `${dateOf(now - t.closedD * DAY)} · ${ago(t.closedD)}` }] : []),
    { k: 'Waiting on', v: t.open ? COURT_LABEL[t.court] : '—' },
  ];

  const activity = asc
    ? [...asc]
        .reverse()
        .map(a => ({ text: activityText(a, users), when: ago((now - a.timestamp) / DAY) }))
        .filter((x): x is { text: string; when: string } => x.text !== null)
        .slice(0, 15)
    : [];

  return {
    id: t.id,
    kind: t.kind === 'desk' ? 'Desk' : 'Board',
    key: t.key,
    title: t.title,
    src: t.src,
    status: STATUS_LABEL[t.st],
    st: t.st,
    stage: t.stage,
    pri: t.pri,
    priLabel: PRI_LABEL[t.pri],
    who: t.who ?? 'Unassigned',
    url: t.url,
    midR: t.midR,
    flags: t.flags,
    timing,
    history,
    fields,
    links,
    activity,
  };
}
