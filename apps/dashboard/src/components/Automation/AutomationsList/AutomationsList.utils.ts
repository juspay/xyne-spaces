import type { Automation, AutomationStatus } from '../Automation.types';

type CatalogLike = { type: string; name: string; icon?: string };

/** Trigger clause only ("When X…") — the step chain is redundant with the row's own action count, so it's dropped here. */
export function summarizeAutomation(
  automation: { config?: { trigger?: { type?: string } | null } },
  triggerCatalog: CatalogLike[],
): string {
  const triggerType = automation.config?.trigger?.type;
  if (!triggerType) return 'No trigger configured';

  const triggerLabel =
    triggerCatalog.find(t => t.type === triggerType)?.name ?? prettyType(triggerType);
  return /^when\b/i.test(triggerLabel)
    ? capitalizeFirst(triggerLabel)
    : `When ${triggerLabel.toLowerCase()}`;
}

/** Backend-assigned icon name for this automation's trigger type (e.g. "Mail", "Webhook", "Ticket") — see each trigger's `icon` field in `apps/backend/src/automations/triggers/*.trigger.ts`. */
export function automationTriggerIconName(
  automation: { config?: { trigger?: { type?: string } | null } },
  triggerCatalog: CatalogLike[],
): string | undefined {
  const triggerType = automation.config?.trigger?.type;
  if (!triggerType) return undefined;
  return triggerCatalog.find(t => t.type === triggerType)?.icon;
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
    case 'PENDING_APPROVAL':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400 dark:border-amber-500/40';
    case 'REJECTED':
    case 'REVOKED':
    case 'AUTO_REVOKED':
      return 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400 dark:border-red-500/40';
    case 'ARCHIVED':
      return 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-400 dark:border-slate-500/40';
    case 'DISABLED':
    case 'DRAFT':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export type AutomationSortField = 'updatedAt' | 'createdAt' | 'name' | 'status';
export type AutomationSortDirection = 'asc' | 'desc';

export interface AutomationSort {
  field: AutomationSortField;
  direction: AutomationSortDirection;
}

export const DEFAULT_AUTOMATION_SORT: AutomationSort = { field: 'updatedAt', direction: 'desc' };

export function sortAutomations(list: Automation[], sort: AutomationSort): Automation[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (sort.field) {
      case 'name':
        return a.name.localeCompare(b.name) * dir;
      case 'status':
        return a.status.localeCompare(b.status) * dir;
      case 'createdAt':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      case 'updatedAt':
      default:
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
    }
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
