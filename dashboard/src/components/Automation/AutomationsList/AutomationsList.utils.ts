import type { Automation, AutomationStatus } from '../Automation.types';

export const LIST_CATEGORIES = ['all', 'tickets', 'email', 'archived'] as const;
export type ListCategory = (typeof LIST_CATEGORIES)[number];

export const LIST_CATEGORY_LABELS: Record<ListCategory, string> = {
  all: 'Current',
  tickets: 'Tickets',
  email: 'Email',
  archived: 'Archived',
};

export function categoryForTrigger(
  triggerType: string | undefined | null,
): Exclude<ListCategory, 'archived'> {
  if (!triggerType) return 'all';
  if (triggerType.startsWith('EMAIL_')) return 'email';
  if (triggerType.startsWith('TICKET_')) return 'tickets';
  return 'all';
}

export const LIST_CATEGORY_DESCRIPTIONS: Record<ListCategory, string> = {
  all: 'Live automations and your in-flight drafts. Archived versions live under their own tab.',
  tickets:
    'These run whenever a ticket is created, assigned, has its status changed, or is updated. Use them to auto-route, escalate, or annotate tickets.',
  email:
    'These run when an inbound email lands on a watched inbox. Use them to auto-reply, assign, tag, or filter mail before a ticket is touched.',
  archived:
    'Previous versions of your automations and any proposals that didn’t become live — rejected, revoked, or auto-revoked when a sibling proposal won.',
};

type CatalogLike = { type: string; name: string };

export function summarizeAutomation(
  automation: { config?: { trigger?: { type?: string } | null; steps?: Array<{ type?: string }> } },
  triggerCatalog: CatalogLike[],
  stepCatalog: CatalogLike[],
): string {
  const triggerType = automation.config?.trigger?.type;
  const steps = automation.config?.steps ?? [];

  const triggerLabel = triggerType
    ? (triggerCatalog.find(t => t.type === triggerType)?.name ?? prettyType(triggerType))
    : null;

  const stepLabels = steps
    .map(s =>
      s.type ? (stepCatalog.find(c => c.type === s.type)?.name ?? prettyType(s.type)) : null,
    )
    .filter((s): s is string => !!s);

  const left = triggerLabel
    ? /^when\b/i.test(triggerLabel)
      ? capitalizeFirst(triggerLabel)
      : `When ${triggerLabel.toLowerCase()}`
    : null;
  const right =
    stepLabels.length === 0
      ? null
      : stepLabels.length === 1
        ? `then ${stepLabels[0]!.toLowerCase()}`
        : `then ${stepLabels[0]!.toLowerCase()} +${stepLabels.length - 1} more`;

  return [left, right].filter(Boolean).join(' · ') || '—';
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

function prettyType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map(w => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function statusPillClasses(status: AutomationStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400 dark:border-green-500/40';
    case 'DISABLED':
      return 'bg-muted text-muted-foreground border-border';
    case 'DRAFT':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function filterAutomations(list: Automation[], query: string): Automation[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(a => {
    if (a.name.toLowerCase().includes(q)) return true;
    if (a.description && a.description.toLowerCase().includes(q)) return true;
    if (a.config?.trigger?.type?.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const seconds = Math.floor((Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
