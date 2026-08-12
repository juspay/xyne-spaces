import type { AutomationStatus } from '../Automation.types';

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
