import { FlowBuilder, type FlowComponent, type FlowDefinition } from './builder.js';

export type ExperimentKind = 'experiment' | 'understanding' | 'framework' | 'security' | 'repo-history';
export type ExperimentCardStatus = 'running' | 'finishing' | 'done' | 'stopped';
export type ExperimentEpochStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type ExperimentFindingStatus = 'conjecture' | 'proved' | 'refuted';
export type ExperimentPlanStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ExperimentLinks {
  preview?: string;
  code?: string;
  terminal?: string;
}

export interface ExperimentFindingRow {
  title: string;
  status: ExperimentFindingStatus;
  epoch: number;
  proof?: string;
  verdict?: string;
}

export interface ExperimentStatusCard {
  runId: string;
  kind: ExperimentKind;
  status: ExperimentCardStatus;
  title: string;
  focus?: string;
  model: string;
  exitRule: string;
  startedAt: string;
  deadlineAt: string;
  endedAt?: string;
  updatedAt: string;
  epoch: number;
  counts: { proved: number; refuted: number; open: number };
  epochs: { completed: number; failed: number };
  hypothesis?: string;
  findings: ExperimentFindingRow[];
  totalFindings: number;
  needsYou: string[];
  links?: ExperimentLinks;
  report?: string;
}

export interface ExperimentPlanItem {
  id: string;
  title: string;
  status: ExperimentPlanStatus;
}

export interface ExperimentEpochCard {
  runId: string;
  epoch: number;
  status: ExperimentEpochStatus;
  hypothesis?: string;
  plan: ExperimentPlanItem[];
  links?: ExperimentLinks;
  retries: number;
  error?: string;
  summary?: string;
  attachments: string[];
  findings: ExperimentFindingRow[];
  startedAt: string;
  endedAt?: string;
}

export interface ExperimentCardRouting {
  agentSlug: string;
  channelId: string;
  conversationId: string;
  userId: string;
}

export const EXPERIMENT_STATUS_COMPONENT_ID = 'experiment-status';
export const EXPERIMENT_EPOCH_COMPONENT_ID = 'experiment-epoch';

const KIND_LABEL: Record<ExperimentKind, string> = {
  experiment: 'Experiment',
  understanding: 'Understanding',
  framework: 'Framework',
  security: 'Security scan',
  'repo-history': 'Repo history',
};

const STATUS_LABEL: Record<ExperimentCardStatus, string> = {
  running: 'Running',
  finishing: 'Finishing',
  done: 'Done',
  stopped: 'Stopped',
};

const EPOCH_STATUS_LABEL: Record<ExperimentEpochStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

const PLAN_STATUS: Record<ExperimentPlanStatus, 'queued' | 'running' | 'done' | 'failed'> = {
  pending: 'queued',
  in_progress: 'running',
  completed: 'done',
  failed: 'failed',
};

export function experimentKindLabel(kind: ExperimentKind): string {
  return KIND_LABEL[kind];
}

export function experimentStatusScreenId(runId: string): string {
  return `experiment-status-${runId}`;
}

export function experimentEpochScreenId(runId: string, sessionId: string): string {
  return `experiment-epoch-${runId}-${sessionId}`;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function cleanLinks(links: ExperimentLinks | undefined): ExperimentLinks | undefined {
  if (!links) return undefined;
  const preview = links.preview?.trim();
  const code = links.code?.trim();
  const terminal = links.terminal?.trim();
  const cleaned: ExperimentLinks = {
    ...(preview ? { preview } : {}),
    ...(code ? { code } : {}),
    ...(terminal ? { terminal } : {}),
  };
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function cleanFinding(row: ExperimentFindingRow): ExperimentFindingRow {
  const proof = row.proof?.trim();
  const verdict = row.verdict?.trim();
  return {
    title: row.title,
    status: row.status,
    epoch: row.epoch,
    ...(proof ? { proof } : {}),
    ...(verdict ? { verdict } : {}),
  };
}

export function experimentStatusFallbackText(card: ExperimentStatusCard): string {
  const counts = `${card.counts.proved} proved · ${card.counts.refuted} refuted · ${card.counts.open} open`;
  return `${KIND_LABEL[card.kind]} · ${STATUS_LABEL[card.status]} · epoch ${card.epoch} · ${counts}`;
}

export function experimentEpochFallbackText(card: ExperimentEpochCard): string {
  const head = `Epoch ${card.epoch} · ${EPOCH_STATUS_LABEL[card.status]}`;
  const tail = card.summary?.trim() || card.hypothesis?.trim() || card.error?.trim();
  if (!tail) return head;
  const firstLine = tail.split('\n').find((line) => line.trim())?.trim() ?? '';
  return `${head} — ${firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine}`;
}

export function buildExperimentStatusFlow(
  card: ExperimentStatusCard,
  routing: ExperimentCardRouting,
): FlowDefinition {
  const props = withoutUndefined({
    runId: card.runId,
    kind: card.kind,
    status: card.status,
    title: card.title,
    focus: card.focus?.trim() || undefined,
    model: card.model,
    exitRule: card.exitRule,
    startedAt: card.startedAt,
    deadlineAt: card.deadlineAt,
    endedAt: card.endedAt,
    updatedAt: card.updatedAt,
    epoch: card.epoch,
    counts: card.counts,
    epochs: card.epochs,
    hypothesis: card.hypothesis?.trim() || undefined,
    findings: card.findings.map(cleanFinding),
    totalFindings: card.totalFindings,
    needsYou: card.needsYou,
    links: cleanLinks(card.links),
    report: card.report?.trim() || undefined,
  });
  const component: FlowComponent = { id: EXPERIMENT_STATUS_COMPONENT_ID, type: 'experiment_status', props };
  return new FlowBuilder(experimentStatusScreenId(card.runId))
    .addComponent(component)
    .setData({
      kind: 'experiment-status',
      actionType: 'experiment-card',
      experimentId: card.runId,
      fallbackText: experimentStatusFallbackText(card),
      ...routing,
    })
    .build();
}

export function buildExperimentEpochFlow(
  card: ExperimentEpochCard,
  sessionId: string,
  routing: ExperimentCardRouting,
): FlowDefinition {
  const props = withoutUndefined({
    runId: card.runId,
    epoch: card.epoch,
    status: card.status,
    hypothesis: card.hypothesis?.trim() || undefined,
    plan: card.plan.map((item) => ({ id: item.id, text: item.title, status: PLAN_STATUS[item.status] })),
    links: cleanLinks(card.links),
    retries: card.retries,
    error: card.error?.trim() || undefined,
    summary: card.summary?.trim() || undefined,
    attachments: card.attachments,
    findings: card.findings.map(cleanFinding),
    startedAt: card.startedAt,
    endedAt: card.endedAt,
  });
  const component: FlowComponent = { id: EXPERIMENT_EPOCH_COMPONENT_ID, type: 'experiment_epoch', props };
  return new FlowBuilder(experimentEpochScreenId(card.runId, sessionId))
    .addComponent(component)
    .setData({
      kind: 'experiment-epoch',
      experimentId: card.runId,
      fallbackText: experimentEpochFallbackText(card),
      ...routing,
    })
    .build();
}
