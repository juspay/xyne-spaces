import type {
  LeadershipConfidence,
  LeadershipItem,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import type { Tone } from './leadershipDashboardTypes';

export const toneClassName: Record<Tone, string> = {
  neutral: 'border-border/70 bg-muted/30 text-muted-foreground',
  good: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  accent: 'border-action-accent/20 bg-action-accent/10 text-action-accent',
};

export const sectionToneClassName: Record<
  Tone,
  { divider: string; rail: string; icon: string; eyebrow: string }
> = {
  neutral: {
    divider: 'border-border/70',
    rail: 'bg-border',
    icon: 'border-border/70 bg-card text-muted-foreground',
    eyebrow: 'text-muted-foreground',
  },
  good: {
    divider: 'border-emerald-500/25',
    rail: 'bg-emerald-500',
    icon: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    eyebrow: 'text-emerald-700 dark:text-emerald-300',
  },
  warn: {
    divider: 'border-amber-500/25',
    rail: 'bg-amber-500',
    icon: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    eyebrow: 'text-amber-700 dark:text-amber-300',
  },
  danger: {
    divider: 'border-rose-500/25',
    rail: 'bg-rose-500',
    icon: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    eyebrow: 'text-rose-700 dark:text-rose-300',
  },
  info: {
    divider: 'border-sky-500/25',
    rail: 'bg-sky-500',
    icon: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    eyebrow: 'text-sky-700 dark:text-sky-300',
  },
  accent: {
    divider: 'border-action-accent/25',
    rail: 'bg-action-accent',
    icon: 'border-action-accent/25 bg-action-accent/10 text-action-accent',
    eyebrow: 'text-action-accent',
  },
};

export const formatLabel = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());

export const cleanText = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, ' ').trim() ?? '';

export const isSystemFallbackNarrative = (value: string | null | undefined): boolean => {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  return (
    /has \d+\/\d+ completed team summaries with \d+ founder-level critical or high-priority initiatives/.test(
      text,
    ) ||
    text.includes(
      'no founder-significant movement or blocker was strongly evidenced beyond the completed team coverage',
    ) ||
    text.includes('no evidence-backed team summary could be produced') ||
    text.includes('no evidence-backed organization summary could be produced') ||
    text.includes('insufficient evidence to assess') ||
    text.includes('insufficient evidence to isolate')
  );
};

export const executiveNarrative = (summary: {
  narrative?: string;
  topBets?: string[];
  topSignals?: string[];
  topBlockers?: string[];
  topRisks?: string[];
  immediateLeadershipActions?: string[];
}): string => {
  const narrative = cleanText(summary.narrative);
  if (narrative && !isSystemFallbackNarrative(narrative)) {
    return narrative;
  }
  return (
    [
      ...(summary.topSignals ?? []),
      ...(summary.topBlockers ?? []),
      ...(summary.topRisks ?? []),
      ...(summary.immediateLeadershipActions ?? []),
      ...(summary.topBets ?? []),
    ]
      .map(cleanText)
      .find(Boolean) ?? ''
  );
};

export const confidenceTone = (confidence?: LeadershipConfidence): Tone => {
  if (confidence === 'HIGH') return 'good';
  if (confidence === 'MEDIUM') return 'warn';
  if (confidence === 'LOW') return 'danger';
  return 'neutral';
};

export const priorityTone = (value?: string): Tone => {
  if (value === 'CRITICAL') return 'danger';
  if (value === 'HIGH') return 'warn';
  if (value === 'MEDIUM') return 'info';
  if (value === 'LOW') return 'neutral';
  return 'neutral';
};

export const rankPriority = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (normalized === 'CRITICAL') return 0;
  if (normalized === 'HIGH') return 1;
  if (normalized === 'MEDIUM') return 2;
  if (normalized === 'LOW') return 3;
  return 4;
};

export const rankStatus = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (['BLOCKED', 'OPEN', 'PENDING', 'CONFLICTING', 'AT_RISK'].includes(normalized)) return 0;
  if (['STALLED', 'REGRESSING'].includes(normalized)) return 1;
  if (['IN_PROGRESS', 'PLANNED'].includes(normalized)) return 2;
  if (['UNKNOWN', 'UNCLEAR'].includes(normalized)) return 3;
  if (['RESOLVED', 'COMPLETED', 'DECIDED'].includes(normalized)) return 4;
  return 5;
};

export const rankMovement = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (['STALLED', 'REGRESSING', 'WEAKENING'].includes(normalized)) return 0;
  if (normalized === 'PROGRESSING_WITH_RISK') return 1;
  if (['PROGRESSING', 'GROWING'].includes(normalized)) return 2;
  if (normalized === 'STABLE') return 3;
  if (['UNCLEAR', 'INSUFFICIENT_BASELINE'].includes(normalized)) return 4;
  return 5;
};

export const rankTimeHorizon = (value: unknown): number => {
  const normalized = cleanText(typeof value === 'string' ? value : undefined).toUpperCase();
  if (normalized === 'IMMEDIATE') return 0;
  if (normalized === 'THIS_WEEK') return 1;
  if (normalized === 'NEXT_TWO_WEEKS') return 2;
  if (normalized === 'LONGER_TERM') return 3;
  return 4;
};

export const compareLeadershipItems = (a: LeadershipItem, b: LeadershipItem): number => {
  const priorityA = rankPriority(
    a.priority ?? a.severity ?? a.riskLevel ?? a.importance ?? a.deadlockRisk,
  );
  const priorityB = rankPriority(
    b.priority ?? b.severity ?? b.riskLevel ?? b.importance ?? b.deadlockRisk,
  );
  if (priorityA !== priorityB) return priorityA - priorityB;

  const statusA = rankStatus(a.status);
  const statusB = rankStatus(b.status);
  if (statusA !== statusB) return statusA - statusB;

  const movementA = rankMovement(a.movement ?? a.currentMovement ?? a.momentum);
  const movementB = rankMovement(b.movement ?? b.currentMovement ?? b.momentum);
  if (movementA !== movementB) return movementA - movementB;

  return rankTimeHorizon(a.timeHorizon) - rankTimeHorizon(b.timeHorizon);
};

export const momentumTone = (value?: string): Tone => {
  if (value === 'FORWARD') return 'good';
  if (value === 'FORWARD_WITH_BLOCKERS' || value === 'MIXED') return 'warn';
  if (value === 'REGRESSING' || value === 'STALLED') return 'danger';
  return 'neutral';
};

export const itemTitle = (item: LeadershipItem): string =>
  cleanText(item.title) ||
  cleanText(item.action) ||
  cleanText(item.decision) ||
  cleanText(item.capability) ||
  cleanText(item.initiative) ||
  'Signal';

export const itemDescription = (item: LeadershipItem): string =>
  cleanText(item.description) ||
  cleanText(item.text) ||
  cleanText(item.assessment) ||
  cleanText(item.why) ||
  cleanText(item.context) ||
  cleanText(item.impact) ||
  cleanText(item.progressDescription) ||
  cleanText(item.whyCritical) ||
  cleanText(item.summary) ||
  cleanText(item.reason);

export const itemDetailNotes = (item: LeadershipItem): string[] =>
  [
    cleanText(item.track ? `Track: ${formatLabel(item.track)}` : ''),
    cleanText(item.matchStrength ? `Match: ${formatLabel(item.matchStrength)}` : ''),
    item.isTeamWorkingTowardsGoal === undefined
      ? ''
      : item.isTeamWorkingTowardsGoal
        ? 'Working toward goal: Yes'
        : 'Working toward goal: No',
    cleanText(item.recommendedAction),
    cleanText(item.expectedOutcome),
    cleanText(item.suggestedOwner ? `Owner: ${item.suggestedOwner}` : ''),
    ...(item.matchedSignals ?? []).map(signal => cleanText(`Signal: ${signal}`)),
    ...(item.evidenceSourceTypes ?? []).map(sourceType =>
      cleanText(`Source: ${formatLabel(sourceType)}`),
    ),
    ...(item.requiredNextSteps ?? []).map(step => cleanText(`Next: ${step}`)),
    ...(item.dependencies ?? []).map(dependency => cleanText(`Dependency: ${dependency}`)),
  ].filter(Boolean);

export const itemBadges = (item: LeadershipItem): Array<{ label: string; tone: Tone }> => {
  const badges: Array<{ label: string; tone: Tone }> = [];
  const priority =
    item.priority ?? item.severity ?? item.riskLevel ?? item.importance ?? item.deadlockRisk;
  if (priority) badges.push({ label: formatLabel(priority), tone: priorityTone(priority) });
  if (item.status)
    badges.push({
      label: formatLabel(item.status),
      tone: item.status === 'OPEN' || item.status === 'BLOCKED' ? 'warn' : 'neutral',
    });
  const movement = item.movement ?? item.currentMovement ?? item.momentum;
  if (movement) badges.push({ label: formatLabel(movement), tone: momentumTone(movement) });
  if (item.track) badges.push({ label: formatLabel(item.track), tone: 'accent' });
  if (item.matchStrength) {
    badges.push({
      label: formatLabel(item.matchStrength),
      tone:
        item.matchStrength === 'STRONG'
          ? 'good'
          : item.matchStrength === 'PARTIAL'
            ? 'info'
            : 'neutral',
    });
  }
  if (item.timeHorizon) badges.push({ label: formatLabel(item.timeHorizon), tone: 'info' });
  const availableTones: Tone[] = ['danger', 'warn', 'info', 'accent', 'good', 'neutral'];
  const usedTones = new Set<Tone>();

  return badges.slice(0, 3).map(badge => {
    const tone = usedTones.has(badge.tone)
      ? (availableTones.find(candidate => !usedTones.has(candidate)) ?? badge.tone)
      : badge.tone;
    usedTones.add(tone);
    return { ...badge, tone };
  });
};

export const firstNonEmpty = (...values: Array<string | undefined | null>): string =>
  values.map(cleanText).find(Boolean) ?? '';
