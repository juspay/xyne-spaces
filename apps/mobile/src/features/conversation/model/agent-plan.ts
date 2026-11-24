import { stripMarkdownForPreview } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownPreview';
import { implicitActionsForComponent } from '@/src/utils/flowAction';
import {
  getPlanComponentViewModel,
  isFlowJsonHtml,
  parseFlowJsonParts,
  type FlowComponentLike,
  type FlowPlanStatusTone,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

export type AgentPlanState = 'done' | 'running' | 'pending' | 'failed';
export type AgentPlanStepState = 'done' | 'running' | 'queued' | 'failed';

export type AgentPlanStep = {
  id: string;
  /** Plain words: the room draws a step as one line of Body/Small, not as markdown. */
  text: string;
  state: AgentPlanStepState;
};

export type AgentPlan = {
  title: string;
  description: string;
  state: AgentPlanState;
  /** The flow's own word for a failed plan ("Rejected", "Failed"); the other states have the room's. */
  failedLabel: string;
  steps: AgentPlanStep[];
  doneCount: number;
};

/** A done plan longer than this opens folded to its header and note. */
const PLAN_FOLD_AFTER_STEPS = 4;

const TAG_LABEL: Readonly<Record<Exclude<AgentPlanState, 'failed'>, string>> = {
  done: 'Done',
  running: 'Working',
  pending: 'Pending',
};

/** The room's plan state for the flow's status tone. */
function stateOfTone(tone: FlowPlanStatusTone): AgentPlanState {
  switch (tone) {
    case 'completed':
      return 'done';
    case 'in_progress':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

const isBlankHtml = (html: string): boolean => html.replace(/<[^>]*>|&nbsp;/g, '').trim() === '';

/**
 * The plan a message carries when it is nothing else: one flow whose only
 * component is a plan, no words around it, and no Approve / Reject waiting on
 * anyone. Anything more (a proposed plan, a plan inside a form) stays the
 * classic flow card, which knows how to run those actions.
 */
export function agentPlanComponent(html: string | null | undefined): FlowComponentLike | null {
  if (!html) return null;
  const parts = parseFlowJsonParts(html);
  const flows = parts.flatMap(part => (part.type === 'flow' ? [part.definition] : []));
  if (flows.length !== 1) return null;
  if (parts.some(part => part.type === 'html' && !isBlankHtml(part.html))) return null;
  const components = flows[0]?.components ?? [];
  const [only] = components;
  if (components.length !== 1 || only?.type !== 'plan') return null;
  return implicitActionsForComponent(only, 'plan').length === 0 ? only : null;
}

/** Whether a message's content is a plan the flat layout draws itself (see `agentPlanComponent`). */
export function isAgentPlanContent(html: string | null | undefined): boolean {
  return agentPlanComponent(html) !== null;
}

/** Whether a message's content is a flow card the flat layout leaves to the classic row. */
export function isClassicFlowContent(html: string | null | undefined): boolean {
  return !!html && isFlowJsonHtml(html) && !isAgentPlanContent(html);
}

/** The plan as the room shows it, from the shared plan view model. */
export function agentPlanFrom(
  component: FlowComponentLike,
  options: FlowTextNormalizationOptions,
): AgentPlan | null {
  const model = getPlanComponentViewModel(component, options);
  if (!model) return null;
  return {
    title: stripMarkdownForPreview(model.title),
    description: stripMarkdownForPreview(model.description),
    state: stateOfTone(model.statusTone),
    failedLabel: model.statusLabel,
    steps: model.todos.map(todo => ({
      id: todo.id,
      text: stripMarkdownForPreview(todo.text),
      // A proposed plan's "included" step has not run yet.
      state: todo.displayStatus === 'included' ? 'queued' : todo.displayStatus,
    })),
    doneCount: model.todos.filter(todo => todo.displayStatus === 'done').length,
  };
}

/** The word in the tag beside the title. */
export function planTagLabel(plan: AgentPlan): string {
  return plan.state === 'failed' ? plan.failedLabel : TAG_LABEL[plan.state];
}

/** The note under the panel: Figma's "<title> — done", else how far the plan got. */
export function planNote(plan: AgentPlan): string {
  if (plan.state === 'done') return `${plan.title} — done`;
  if (plan.steps.length === 0) return plan.state === 'pending' ? 'Not started' : planTagLabel(plan);
  return `${plan.doneCount} of ${plan.steps.length} done`;
}

/** Long finished plans open folded; a plan still running always shows its steps. */
export function planStartsFolded(plan: AgentPlan): boolean {
  return plan.state === 'done' && plan.steps.length > PLAN_FOLD_AFTER_STEPS;
}
