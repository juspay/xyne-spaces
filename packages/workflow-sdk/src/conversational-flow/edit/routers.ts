/**
 * The router: what reads a typed message and opens the screen that fits.
 *
 * Two things here are the author's, and nothing else is. Which service answers,
 * and what they want it told — and, per screen or per section, which router the
 * typing goes to.
 *
 * What a router may *choose* is never edited: it is the screens its own frame
 * holds, which `settle` writes after every change. So a router in the
 * conversation's frame reaches the whole flow and one inside a section reaches
 * that section, without anything having to say so.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, type Step } from '../json.js';
import { caseFor } from '../locate.js';
import { frameOf, routerFor, routersFor, routersOf, scopeOf } from '../routers.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { jumpsIn, partsOf, screenCase } from '../shape.js';
import { subtreeOf } from '../tree.js';
import { pointTypingAt } from '../typing.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { decidingStep, routerAnswer, routerSteps, type RouterMode } from './build.js';
import { frameFor, lift } from './cases.js';

export interface RouterService {
  /** The model id the classifier asks for. */
  model?: string;
  /** The credential holding where that service lives and the key it takes. */
  credentialName?: string | null;
  /** Below this it opens the first screen instead of guessing; `null` to stop. */
  minConfidence?: number | null;
}

/**
 * Which service decides, for every router in the flow.
 *
 * One flow, one service: a router in a section asks the same model as the one
 * at the top, because the choice is about the deployment and not about the
 * screens being chosen between.
 */
export function setRouterService(config: WorkflowConfig, service: RouterService): WorkflowConfig {
  const flow = requireFlow(config);
  if (typeof service.minConfidence === 'number' && (service.minConfidence < 0 || service.minConfidence > 1)) {
    throw new ConversationalFlowEditError('How sure it must be is a fraction between 0 and 1.');
  }
  if (!flow.screens.some((s) => s.router?.mode === 'classifier')) {
    throw new ConversationalFlowEditError('This flow has no classifier to configure.');
  }
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    for (const screen of live.screens) {
      if (screen.router?.mode !== 'classifier') continue;
      const step = decidingStep_(draft, live, screen);
      if (!step) continue;
      if (service.model !== undefined) step.config['model'] = service.model;
      if (service.credentialName !== undefined) {
        if (service.credentialName) step.config['credentialName'] = service.credentialName;
        else delete step.config['credentialName'];
      }
      if (service.minConfidence !== undefined) {
        // Where an unsure message goes follows from where the router sits, so
        // `settle` places it; this only says whether there is a bar at all.
        if (service.minConfidence === null) delete step.config['minConfidence'];
        else step.config['minConfidence'] = service.minConfidence;
      }
    }
  });
}

/**
 * What the author wants this router told, on top of the screens themselves.
 * Kept on the step's description, and put first in what it is asked.
 */
export function setRouterGuidance(config: WorkflowConfig, screenId: string, guidance: string): WorkflowConfig {
  requireRouter(requireFlow(config), screenId);
  const text = guidance.trim();
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const step = decidingStep_(draft, live, requireRouter(live, screenId));
    if (!step) return;
    if (text) step.description = text;
    else delete step.description;
  });
}

function decidingStep_(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Step | undefined {
  const entry = caseFor(config, flow, screen);
  if (!entry) return undefined;
  return partsOf(entry, flow.routeKey).rest.find((step) => step.id === screen.router?.stepId);
}

function requireRouter(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  if (!screen.router) throw new ConversationalFlowEditError(`“${screen.title}” doesn’t read typed messages.`);
  return screen;
}

export type { RouterMode } from './build.js';

/**
 * Change what answers this router, keeping everything about it that is the
 * author's: its guidance, and the screens it may open — which are its frame's,
 * not its own.
 *
 * The step keeps its id, so the jump that carries its answer only has to name
 * the answer differently: a class, or a field of what the agent replied.
 */
export function setRouterMode(config: WorkflowConfig, screenId: string, wanted: RouterMode): WorkflowConfig {
  requireRouter(requireFlow(config), screenId);
  if (wanted.mode === 'agent' && !wanted.agentSlug.trim()) {
    throw new ConversationalFlowEditError('Say which agent should read what they type.');
  }
  return settle(config, (draft) => {
    const flow = requireFlow(draft);
    const screen = requireRouter(flow, screenId);
    const entry = caseFor(draft, flow, screen);
    const old = decidingStep_(draft, flow, screen);
    if (!entry || !old) return;

    const steps = asArray(entry['steps']);
    const at = steps.indexOf(old);
    if (at === -1) return;
    steps[at] = decidingStep(old.id, wanted, old.description);

    const answer = routerAnswer(old.id, wanted, flow.routeKey);
    for (const jump of jumpsIn(steps)) {
      const carried = asRec(jump.config['with']);
      if (String(carried[flow.routeKey] ?? '').includes(`steps.${old.id}.output`)) carried[flow.routeKey] = answer;
    }
  });
}

// ─── Which router a screen's typing goes to ───

/**
 * Send what is typed on one screen to a particular router.
 *
 * This is the exception, made screen by screen: a screen inside Payments may keep
 * its typing in Payments while its neighbour asks the router at the top. Only a
 * router whose frame encloses the screen can be reached from it.
 */
export function setTypedRouter(config: WorkflowConfig, screenId: string, routerId: string): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  const router = requireRouter(flow, routerId);
  if (!routersFor(flow, screenId).some((r) => r.id === routerId)) {
    const where = scopeOf(flow, router);
    throw new ConversationalFlowEditError(
      `“${router.title}” only serves ${where ? `“${where.title}” and the screens inside it` : 'the conversation'}, so “${screen.title}” cannot reach it.`,
    );
  }
  if (!screen.prompts.some((p) => p.freeText)) {
    throw new ConversationalFlowEditError(`“${screen.title}” doesn’t take typing. Turn it on first.`);
  }
  return settle(config, (draft) => {
    pointTypingAt(draft, requireFlow(draft), screenId, routerId);
  });
}

/**
 * Keep typed messages inside a section — or stop keeping them there.
 *
 * On: the section gets a router of its own, in its own frame, asking the same
 * service as the flow's, and every screen inside it sends its typing there. Off:
 * that router goes, and those screens fall back to the nearest one outside.
 *
 * It is a bulk action rather than a rule, which is what makes an exception
 * possible at all: a total derivation would erase one on the next edit.
 */
export function scopeRouter(config: WorkflowConfig, sectionId: string, on: boolean): WorkflowConfig {
  const flow = requireFlow(config);
  const section = requireScreen(flow, sectionId);
  if (sectionId === flow.rootScreen) {
    throw new ConversationalFlowEditError('The conversation’s own router already serves everything.');
  }
  const existing = routersOf(flow).find((r) => frameOf(flow, r) === sectionId);
  if (on === Boolean(existing)) return config;

  if (on) {
    if (section.children.length === 0) {
      throw new ConversationalFlowEditError(`Nothing is inside “${section.title}”, so there is nothing to keep typing in.`);
    }
    const outer = routersFor(flow, sectionId)[0]?.router;
    const wanted: RouterMode = outer?.mode === 'agent'
      ? { mode: 'agent', agentSlug: outer.agent ?? '' }
      : {
          mode: 'classifier',
          ...(outer?.model ? { model: outer.model } : {}),
          ...(outer?.credentialName ? { credentialName: outer.credentialName } : {}),
          ...(outer?.minConfidence !== undefined ? { minConfidence: outer.minConfidence } : {}),
        };
    const routerId = unique(`route_${sectionId}`, new Set(flow.screens.map((s) => s.id)));

    return settle(config, (draft) => {
      const live = requireFlow(draft);
      const built = routerSteps(draft, live, { screenId: routerId, wanted });
      frameFor(draft, live, sectionId).push(screenCase(routerId, `${section.title} — typed messages`, built, live.routeKey));
      const settled = requireFlow(draft);
      for (const id of subtreeOf(settled, sectionId)) pointTypingAt(draft, settled, id, routerId);
    });
  }

  const router = existing!;
  const fallback = routersFor(flow, sectionId).find((r) => r.id !== router.id);
  if (!fallback) {
    throw new ConversationalFlowEditError('There is no other router to send typed messages to.');
  }
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    for (const id of subtreeOf(live, sectionId)) {
      if (routerFor(live, id)?.id === router.id) pointTypingAt(draft, live, id, fallback.id);
    }
    lift(draft, requireFlow(draft), router.id);
  });
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}

function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  return name;
}
