import { FLAG_CFG } from './config';
import type { MTicket, Model } from './model';

/** Why a ticket needs attention — the redesign's rules applied to the loaded model. */

export type Sev = 'red' | 'amber' | 'watch' | 'ok';
export type FlagType =
  | 'eta'
  | 'stageEta'
  | 'deskEarly'
  | 'crmEarly'
  | 'productStuck'
  | 'ageing'
  | 'stale'
  | 'longHold'
  | 'placeholder'
  | 'notEscalated';

export interface Flag {
  type: FlagType;
  sev: Exclude<Sev, 'ok'>;
  label: string;
  reason: string;
}

export const FLAG_LABEL: Record<FlagType, string> = {
  eta: 'Ticket ETA breached',
  stageEta: 'Stage ETA breached',
  deskEarly: 'Desk closed, board open',
  crmEarly: 'Parent closed, sub-ticket open',
  productStuck: 'Sub-ticket stuck',
  ageing: 'Ageing',
  stale: 'Stale',
  longHold: 'Long hold',
  placeholder: 'Unlinked sub-ticket',
  notEscalated: 'Not escalated',
};

export const RANK: Record<Sev, number> = { red: 3, amber: 2, watch: 1, ok: 0 };
export const HEALTH: Record<Sev, string> = { red: 'Critical', amber: 'At risk', watch: 'Watch', ok: 'Healthy' };

/** "just now" / "5h" / "3d". */
export function fmtDays(x: number): string {
  if (x < 1 / 24) return 'just now';
  if (x < 1) return `${Math.floor(x * 24)}h`;
  return `${Math.floor(x)}d`;
}

const COURT_NAME = { us: 'us', merchant: 'the merchant', external: 'an external party' } as const;

export function flagsFor(t: MTicket, m: Model, cfg = FLAG_CFG): Flag[] {
  const out: Flag[] = [];
  const add = (type: FlagType, sev: Flag['sev'], reason: string): void => {
    out.push({ type, sev, label: FLAG_LABEL[type], reason });
  };
  const kids = t.kids.map(id => m.tickets.get(id)).filter((k): k is MTicket => k !== undefined);
  const boardKids = kids.filter(k => k.kind !== 'desk');
  const o = t.open;

  if (o && t.eta != null && t.eta < 0) add('eta', 'red', `ETA passed ${fmtDays(-t.eta)} ago, still ${t.stage.toLowerCase()}`);
  if (o && t.stageOverdue) add('stageEta', 'red', `${t.stage} is past its stage ETA`);
  if (t.kind === 'desk' && !o) {
    const k = boardKids.find(x => x.open);
    if (k) add('deskEarly', 'red', `Desk resolved ${fmtDays(t.closedD ?? 0)} ago while ${k.key} is still open — the merchant may have been told it's done`);
  }
  if (t.kind === 'crm' && !o) {
    const k = boardKids.find(x => x.open);
    if (k) add('crmEarly', 'red', `Board ticket closed ${fmtDays(t.closedD ?? 0)} ago; ${k.key} is still ${k.stage.toLowerCase()}`);
  }
  if (t.kind === 'product' && o && (!t.who || Math.floor(t.u) > cfg.stale)) {
    add('productStuck', 'red', !t.who ? `Unassigned for ${fmtDays(t.d)}` : `No update in ${fmtDays(t.u)}`);
  }
  if (t.kind !== 'desk' && o && Math.floor(t.d) > cfg.ageing) add('ageing', 'amber', `Open ${Math.floor(t.d)}d (limit ${cfg.ageing}d)`);
  if (t.kind === 'crm' && o && t.court === 'us' && Math.floor(t.u) > cfg.stale) add('stale', 'amber', `No update in ${Math.floor(t.u)}d`);
  if (o && t.court !== 'us' && Math.floor(t.u) > cfg.longHold) add('longHold', 'amber', `On hold with ${COURT_NAME[t.court]} for ${Math.floor(t.u)}d`);
  if (o) {
    for (const p of t.placeholders) {
      if (p.d > cfg.placeholder) add('placeholder', 'amber', `"${p.title}" has no linked ticket for ${p.d}d`);
    }
  }
  if (t.kind === 'desk' && o && kids.length === 0 && t.court === 'us' && Math.floor(t.d) > cfg.escalate) {
    add('notEscalated', 'watch', `Open ${Math.floor(t.d)}d with no board ticket`);
  }
  return out;
}

export function sevOf(flags: { sev: Sev }[]): Sev {
  return flags.reduce<Sev>((worst, f) => (RANK[f.sev] > RANK[worst] ? f.sev : worst), 'ok');
}
