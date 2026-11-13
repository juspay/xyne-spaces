/**
 * A screen that asks differently depending on the data.
 *
 * The construct is the one a Questions screen already uses — a SWITCH inside the
 * case, picking what to ask — with the condition on data instead of on what they
 * tapped. Position tells them apart: a versions switch comes *before* any
 * question, a follow-up switch after one.
 *
 *   case eq(screen,'my_details')
 *     SWITCH versions_my_details
 *       ├ when {{…body.plan}} eq "priority"  → [ WAIT …__priority, its gate, its jumps ]
 *       └ default                            → [ WAIT …,           its gate, its jumps ]
 *
 * Each branch carries its whole tail rather than sharing one: the gate has to
 * name the question it reads, and no template can say "whichever ran". So a
 * version is a complete way of asking — its wording, its options, both — which
 * is also how the editor presents it.
 *
 * Adding the first version wraps what is already there, untouched, as `default`;
 * removing the last unwraps it again, leaving exactly what was there before.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, asSteps, type Rec, type Step } from '../json.js';
import { caseFor } from '../locate.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { partsOf } from '../shape.js';
import { labelFor, leavesOf } from '../conditions.js';
import { copyWithFreshIds } from './clone.js';
import type { Condition, ConversationalFlow, Screen } from '../types.js';

/**
 * Ask this screen a second way when `when` holds.
 *
 * The new version starts as a copy of the one asked otherwise — same wording,
 * same options — because an author changes what differs, and everything that
 * doesn't should already be right.
 */
export function addVersion(
  config: WorkflowConfig,
  screenId: string,
  when: Condition,
): { config: WorkflowConfig; promptId: string } {
  requireAsking(requireFlow(config), screenId);
  requireCondition(when);

  let added = '';
  const next = settle(config, (draft) => {
    const live = requireFlow(draft);
    const entry = caseFor(draft, live, requireAsking(live, screenId));
    if (!entry) return;
    const steps = asArray(entry['steps']);
    const { rest } = partsOf(entry, live.routeKey);
    const lead = steps.slice(0, steps.length - rest.length);

    const versions = rest[0]?.type === 'SWITCH' ? rest[0] : undefined;
    const ordinary = versions ? asSteps(asRec(versions.config)['default']) : rest;
    const taken = new Set(idsIn(draft));
    const copy = copyWithFreshIds(ordinary, unique(`${screenId}__${asArray(asRec(versions?.config)['cases']).length + 1}`, taken));
    added = copy[0]?.id ?? '';

    if (versions) {
      asArray(versions.config['cases']).push({ label: labelFor(when), condition: { ...when }, steps: copy });
      return;
    }
    entry['steps'] = [
      ...lead,
      {
        id: unique(`versions_${screenId}`, taken),
        type: 'SWITCH',
        config: { cases: [{ label: labelFor(when), condition: { ...when }, steps: copy }], default: ordinary },
      },
    ];
  });
  return { config: next, promptId: added };
}

/** Change when a version is asked. */
export function setVersionWhen(config: WorkflowConfig, promptId: string, when: Condition): WorkflowConfig {
  requireCondition(when);
  const flow = requireFlow(config);
  requireVersion(flow, promptId);
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const found = versionCase(draft, live, promptId);
    if (found) {
      found.entry['condition'] = { ...when };
      found.entry['label'] = labelFor(when);
    }
  });
}

/**
 * Take a version away. The one asked when nothing else holds cannot go — it is
 * what the screen does — and removing the last conditional one unwraps the
 * switch, leaving the case as it was before any version was added.
 */
export function removeVersion(config: WorkflowConfig, promptId: string): WorkflowConfig {
  const flow = requireFlow(config);
  requireVersion(flow, promptId);
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const found = versionCase(draft, live, promptId);
    if (!found) return;
    const cases = asArray(found.versions.config['cases']);
    const at = cases.indexOf(found.entry);
    if (at >= 0) cases.splice(at, 1);
    if (cases.length > 0) return;

    // The last one: unwrap, and the case is what it was.
    const entry = caseFor(draft, live, found.screen);
    if (!entry) return;
    const steps = asArray(entry['steps']);
    const where = steps.indexOf(found.versions);
    if (where >= 0) steps.splice(where, 1, ...asSteps(asRec(found.versions.config)['default']));
  });
}

// ─── Plumbing ───

/** The switch, the case and the screen a version's question belongs to. */
function versionCase(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  promptId: string,
): { screen: Screen; versions: Step; entry: Rec } | undefined {
  for (const screen of flow.screens) {
    if (!screen.versions.some((v) => v.promptId === promptId)) continue;
    const entry = caseFor(draft, flow, screen);
    const versions = entry ? partsOf(entry, flow.routeKey).rest[0] : undefined;
    if (versions?.type !== 'SWITCH') continue;
    for (const raw of asArray(versions.config['cases'])) {
      const test = asRec(raw);
      if (asSteps(test['steps'])[0]?.id === promptId) return { screen, versions, entry: test };
    }
  }
  return undefined;
}

/** Every id in the config, so a copy never collides with one. */
function idsIn(config: WorkflowConfig): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const rec = value as Rec;
    if (typeof rec['id'] === 'string') out.push(rec['id']);
    Object.values(rec).forEach(walk);
  };
  walk(config.steps);
  return out;
}

function requireCondition(when: Condition): void {
  const leaves = leavesOf(when);
  if (leaves.length === 0) throw new ConversationalFlowEditError('A condition needs something to test.');
  for (const leaf of leaves) {
    if (!leaf.variable.trim()) throw new ConversationalFlowEditError('Say which value decides.');
    if (!leaf.operator.trim()) throw new ConversationalFlowEditError('Say how to compare it.');
  }
}

function requireAsking(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  // A Finish asks nothing, but it can close more than one way.
  if (screen.kind === 'input') {
    // Every way would be its own WAIT with its own id, and what reads the
    // answer from inside the frame can only name one of them. Asking
    // differently belongs to the screen inside, which can also branch on what
    // was just answered.
    throw new ConversationalFlowEditError(
      `“${screen.title}” asks one way, so that what it opens can read the answer. Ask differently on the screen inside it.`,
    );
  }
  if (screen.prompts.length === 0 && screen.kind !== 'end') {
    throw new ConversationalFlowEditError(`“${screen.title}” doesn’t ask anything, so there is nothing to ask differently.`);
  }
  return screen;
}

function requireVersion(flow: ConversationalFlow, promptId: string): void {
  for (const screen of flow.screens) {
    if (screen.versions.some((v) => v.promptId === promptId && v.when)) return;
    if (screen.versions.some((v) => v.promptId === promptId) || screen.prompts.some((p) => p.id === promptId)) {
      throw new ConversationalFlowEditError('This is what the screen asks when nothing else holds; it has no condition.');
    }
  }
  throw new ConversationalFlowEditError(`There is no question “${promptId}”.`);
}

function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  return name;
}
