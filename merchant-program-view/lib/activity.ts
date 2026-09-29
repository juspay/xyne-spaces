/**
 * A ticket's activity feed, worded like the dashboard's TicketActivity: "{actor} {what changed}",
 * old and new values in bold. Every row is shown; types without wording read "made a change".
 */

export interface ActivityInput {
  id: string;
  ticketId: string;
  activityType: string;
  value: unknown;
  timestamp: number;
  /** User id of whoever made the change. */
  updatedBy?: string | null;
}

/** Plain text, a bold value, or a link. Text starting with punctuation joins the previous part without a space. */
export type Part = string | { b: string } | { link: string; href?: string };

export type ActivityIcon = 'avatar' | 'status' | 'priority' | 'tag' | 'calendar' | 'subticket' | 'board' | 'archive' | 'merge' | 'mail' | 'file' | 'check';

export interface ActivityItem {
  id: string;
  /** Display name of who did it; null when the sentence stands alone ("Auto-assigned to …"). */
  actor: string | null;
  actorId: string | null;
  parts: Part[];
  at: number;
  icon: ActivityIcon;
}

export interface Lookups {
  user: (id: string) => string | undefined;
  group: (id: string) => string | undefined;
  board: (id: string) => string | undefined;
}

interface V {
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  action?: string;
  reason?: string;
  isAutomation?: boolean;
  isAiClassification?: boolean;
  subTicketXyneId?: string;
  subTicketId?: string;
  subTicketAction?: string;
  sourceTicketId?: string;
  sourceTicketXyneId?: string;
  referenceTitle?: string;
  targetTicketTitle?: string;
  targetTicketXyneId?: string;
  fieldName?: string;
  contextName?: string;
  stageName?: string;
  emailType?: string;
  rating?: unknown;
  score?: unknown;
  prId?: string | number;
  prUrl?: string;
  authorName?: string;
  remainingOpenPRs?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (v: unknown): string => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v ? Date.parse(v) : NaN;
  if (!Number.isFinite(n)) return 'none';
  const d = new Date(n);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const str = (v: unknown, none = 'none'): string => (v === null || v === undefined || v === '' ? none : String(v));
const fromTo = (verb: string, o: string, n: string): Part[] => [`${verb} from`, { b: o }, 'to', { b: n }];

export function activityItem(a: ActivityInput, look: Lookups): ActivityItem {
  const v = (a.value && typeof a.value === 'object' ? a.value : {}) as V;
  const who = (id: unknown): string => (typeof id === 'string' && id ? look.user(id) ?? 'Someone' : 'Unassigned');
  let actor: string | null = v.isAiClassification ? 'AI classification' : v.isAutomation ? 'Automation' : a.updatedBy ? look.user(a.updatedBy) ?? 'Someone' : 'Someone';
  let icon: ActivityIcon = 'avatar';
  let parts: Part[];

  switch (a.activityType) {
    case 'TITLE':
      parts = fromTo('updated title', str(v.oldValue), str(v.newValue));
      break;
    case 'DESCRIPTION':
      parts = ['updated description'];
      break;
    case 'STATUS':
    case 'STAGE_NAME':
      icon = 'status';
      parts = fromTo(v.field === 'stageName' ? 'moved ticket' : 'changed status', str(v.oldValue), str(v.newValue));
      break;
    case 'TICKET_TYPE':
      parts = fromTo('changed ticket type', str(v.oldValue), str(v.newValue));
      break;
    case 'PRIORITY':
      icon = 'priority';
      if (v.reason === 'AI priority classification') {
        actor = null;
        parts = fromTo('Auto-assigned priority', str(v.oldValue), str(v.newValue));
      } else parts = fromTo('changed priority', str(v.oldValue), str(v.newValue));
      break;
    case 'ASSIGNED_TO':
      if (v.reason === 'AI classification' || v.reason === 'Default channel group') {
        actor = null;
        parts = ['Auto-assigned to', { b: who(v.newValue) }];
      } else if (a.updatedBy && a.updatedBy === v.newValue) parts = ['self-assigned the ticket'];
      else parts = fromTo('changed assignment', who(v.oldValue), who(v.newValue));
      break;
    case 'QA':
      parts = a.updatedBy && a.updatedBy === v.newValue ? ['self-assigned as QA'] : v.oldValue ? fromTo('assigned QA', who(v.oldValue), who(v.newValue)) : ['assigned QA', { b: who(v.newValue) }];
      break;
    case 'PR_REVIEWER':
      parts = a.updatedBy && a.updatedBy === v.newValue ? ['self-assigned as PR Reviewer'] : ['assigned PR Reviewer', { b: who(v.newValue) }];
      break;
    case 'USER_GROUP_ID': {
      const g = (id: unknown): string => (typeof id === 'string' ? look.group(id) ?? 'Unknown' : 'Unknown');
      parts = v.oldValue && v.newValue ? fromTo('transferred ticket', g(v.oldValue), g(v.newValue)) : v.newValue ? ['transferred ticket to', { b: g(v.newValue) }] : ['removed user group', { b: g(v.oldValue) }];
      break;
    }
    case 'BOARD': {
      icon = 'board';
      const b = (id: unknown): string => (typeof id === 'string' ? look.board(id) ?? id : str(id));
      parts = ['moved ticket from board', { b: b(v.oldValue) }, 'to', { b: b(v.newValue) }];
      break;
    }
    case 'ETA':
      icon = 'calendar';
      parts = fromTo('changed due date', day(v.oldValue), day(v.newValue));
      break;
    case 'STAGE_ETA':
      icon = 'calendar';
      parts = fromTo('updated stage deadline', day(v.oldValue), day(v.newValue));
      break;
    case 'TAGS':
      icon = 'tag';
      parts = [v.action === 'removed' ? 'removed a label:' : 'added a label:', { b: str(v.newValue || v.oldValue) }];
      break;
    case 'SUBTICKET_CREATED':
    case 'SUBTICKET_LINKED':
    case 'SUBTICKET_UNLINKED': {
      icon = 'subticket';
      const verb = a.activityType === 'SUBTICKET_CREATED' ? 'created' : a.activityType === 'SUBTICKET_LINKED' ? 'linked' : 'unlinked';
      parts = [`${verb} subticket`, { b: v.subTicketXyneId || (v.subTicketId ?? '').slice(0, 8).toUpperCase() || 'sub-ticket' }];
      break;
    }
    case 'MERGED':
      icon = 'merge';
      parts = v.sourceTicketId ? ['merged', { b: v.sourceTicketXyneId || v.sourceTicketId }, 'into this ticket'] : ['merged this ticket into', { b: v.referenceTitle || 'another ticket' }];
      break;
    case 'UNMERGED':
      icon = 'merge';
      parts = v.sourceTicketId ? ['unmerged', { b: v.sourceTicketXyneId || v.sourceTicketId }, 'from this ticket'] : ['unmerged this ticket from', { b: v.referenceTitle || 'another ticket' }];
      break;
    case 'REFERENCE_TICKET': {
      const title = v.targetTicketTitle || v.targetTicketXyneId || 'ticket';
      parts = v.action === 'created' ? ['added related ticket', { b: title }] : v.action === 'removed' ? ['removed related ticket', { b: title }] : ['updated related ticket', { b: title }];
      break;
    }
    case 'IS_ARCHIVED':
      icon = 'archive';
      parts = ['archived the ticket'];
      break;
    case 'EMAIL_SENT':
      icon = 'mail';
      parts = [v.emailType === 'COMPOSE' ? 'sent an email' : 'sent an email reply'];
      break;
    case 'TICKET_CREATED':
      parts = ['created the ticket'];
      break;
    case 'CSAT_RECEIVED':
      actor = null;
      parts = ['CSAT received', { b: str(v.rating ?? v.newValue) }];
      break;
    case 'METADATA': {
      const ctx = v.contextName ?? v.stageName;
      const field = `${v.fieldName ?? 'custom field'}${ctx ? ` in ${ctx} form` : ''}`;
      if (v.field === 'customField') {
        const o = v.oldValue == null || v.oldValue === '' ? null : String(v.oldValue);
        const n = v.newValue == null || v.newValue === '' ? null : String(v.newValue);
        parts = o && n ? fromTo(`updated ${field}`, o, n) : n ? [`set ${field}`, { b: n }] : [`cleared ${field}`, { b: o ?? '' }];
      } else if (v.field === 'emailReply') {
        icon = 'mail';
        parts = ['replied to the email'];
      } else if (v.field === 'stageFormFile') {
        icon = 'file';
        parts = [v.action === 'removed' ? `removed file from ${field}` : v.action === 'updated' ? `replaced file in ${field}` : `uploaded file to ${field}`];
      } else if (v.field === 'flowConfirmation') {
        icon = 'check';
        parts = ['completed the confirmation'];
      } else if (v.field === 'csatRequest') parts = ['sent a CSAT survey to the customer'];
      else parts = ['updated metadata'];
      break;
    }
    case 'PR': {
      // "PR #12 merged, A → B, author: X, 2 PRs remaining"; the author stands in for the actor.
      actor = null;
      icon = 'status';
      const moved = v.field === 'stageName' && v.oldValue && v.newValue && v.oldValue !== v.newValue;
      parts = [
        'PR',
        { link: `#${str(v.prId, '?')}`, href: typeof v.prUrl === 'string' && /^https?:\/\//.test(v.prUrl) ? v.prUrl : undefined },
        v.action || 'updated',
        ...(moved ? [',', { b: String(v.oldValue) }, '→', { b: String(v.newValue) }] : []),
        ...(v.authorName ? [', author:', { b: v.authorName }] : []),
        ...(v.remainingOpenPRs ? [`, ${v.remainingOpenPRs} PRs remaining`] : []),
      ];
      break;
    }
    default:
      parts = ['made a change'];
  }
  return { id: a.id, actor, actorId: a.updatedBy ?? null, parts, at: a.timestamp, icon };
}
