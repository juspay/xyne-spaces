import type {
  NavigateChooseRequest,
  NavigateChooseResult,
  NavigateStepRequest,
  NavigateStepResult,
} from '../../../services/assistantNavigateService';
import type { NavigationRun, ScreenWait } from './runNavigation';

/*
 * Dev-only console trace of a navigation run: what was on screen, what went to the backend,
 * what the backend sent Jev, what Jev answered, and why the run moved on or stopped. Console
 * only, never the app logger: all of it is user content.
 */
/* eslint-disable no-console */

const ENABLED = import.meta.env.DEV;
const TAG = '[navigator]';

const pct = (p: number | undefined): string => (p === undefined ? '—' : p.toFixed(3));

export function logRunStart(goal: string): void {
  if (!ENABLED) return;
  console.log(`${TAG} ▶ run started: "${goal}"`);
}

export function logStep(
  step: number,
  wait: ScreenWait,
  request: NavigateStepRequest,
  response: NavigateStepResult,
  requestMs: number,
): void {
  if (!ENABLED) return;
  const decision =
    response.status === 'click'
      ? `click ${response.id}`
      : response.status === 'stuck'
        ? `stuck (${response.reason})`
        : response.status === 'unavailable'
          ? `unavailable (${response.debug?.unavailableReason ?? response.error ?? 'unknown'})`
          : response.status;
  console.groupCollapsed(
    `${TAG} step ${step}: ${decision} — waited ${wait.waitedMs}ms for screen, request ${requestMs}ms`,
  );

  console.log(
    '1. screen wait',
    wait.timedOut
      ? `⚠ gave up after ${wait.waitedMs}ms; screen still changing${wait.loader ? ` or loading (${wait.loader})` : ''}`
      : `stable after ${wait.waitedMs}ms (${wait.polls} checks)`,
    wait,
  );
  console.log('2. page snapshot', request.page);
  console.log(`3. ${request.candidates.length} candidates`);
  console.table(request.candidates);
  console.log('4. request sent to backend', request);

  const debug = response.debug;
  if (debug?.jevRequest) {
    console.log(`5. request sent to Jev (${debug.jevRequest.model} @ ${debug.jevRequest.url})`, {
      model: debug.jevRequest.model,
      state: debug.jevRequest.state,
      questions: debug.jevRequest.questions,
    });
  } else {
    console.log('5. request sent to Jev: not sent', {
      reason: debug?.unavailableReason ?? response.error ?? 'no debug info (production backend?)',
    });
  }

  const answers = debug?.jevAnswers;
  if (answers) {
    const reached = answers['reached'];
    console.log(
      `6. Jev answer — reached: ${reached?.type === 'noul' ? pct(reached.noul) : '—'}`,
      answers,
    );
    const next = answers['next'];
    if (next?.type === 'choice') {
      const descriptions = new Map(request.candidates.map(c => [c.id, c.description]));
      console.table(
        Object.entries(next.probabilities)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, p]) => ({
            id,
            p: pct(p),
            description: id === 'none' ? '(none of these)' : (descriptions.get(id) ?? '?'),
          })),
      );
    }
  } else if (debug?.jevFailure || response.error) {
    console.log('6. Jev failed', debug?.jevFailure ?? response.error);
  }

  console.log(`7. decision: ${decision}`, {
    response: { ...response, debug: undefined },
    thresholds: debug?.thresholds,
    pNone: debug?.pNone,
    backendLatencyMs: debug?.latencyMs,
  });
  console.groupEnd();
}

export function logClick(
  description: string,
  urlBefore: string,
  urlAfter: string,
  changed: boolean,
): void {
  if (!ENABLED) return;
  console.log(
    `${TAG}   ↳ clicked "${description}"`,
    !changed
      ? '⚠ nothing changed: dead end, will not be offered again'
      : urlBefore === urlAfter
        ? `(same url, screen changed: ${urlAfter})`
        : `${urlBefore} → ${urlAfter}`,
  );
}

export function logRunEnd(run: NavigationRun): void {
  if (!ENABLED) return;
  console.log(
    `${TAG} ■ run ended: ${run.status}${run.detail ? ` — ${run.detail}` : ''} after ${run.steps.length} click(s)`,
  );
  if (run.steps.length > 0) console.table(run.steps);
}

/* eslint-disable no-console */
export function logChoose(
  stage: string,
  request: NavigateChooseRequest,
  response: NavigateChooseResult,
  requestMs: number,
): void {
  if (!ENABLED) return;
  const descriptions = new Map(request.options.map(o => [o.id, o.description]));
  const decision =
    response.status === 'chosen'
      ? `chose ${response.id} "${descriptions.get(response.id)}" (${pct(response.confidence)})`
      : response.status === 'unsure'
        ? `unsure, best ${response.id} (${pct(response.confidence)})`
        : response.status === 'none'
          ? `none (p ${pct(response.pNone)})`
          : `unavailable (${response.debug?.unavailableReason ?? response.error ?? 'unknown'})`;
  console.groupCollapsed(`${TAG} pick ${stage}: ${decision} — ${Math.round(requestMs)}ms`);
  console.log(`${request.options.length} options`);
  console.table(request.options);
  if (response.debug?.jevRequest) {
    console.log(`request sent to Jev (${response.debug.jevRequest.model})`, {
      state: response.debug.jevRequest.state,
      questions: response.debug.jevRequest.questions,
    });
  }
  const pick = response.debug?.jevAnswers?.['pick'];
  if (pick?.type === 'choice') {
    console.table(
      Object.entries(pick.probabilities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, p]) => ({
          id,
          p: pct(p),
          description: id === 'none' ? '(none of these)' : (descriptions.get(id) ?? '?'),
        })),
    );
  } else if (response.debug?.jevFailure || response.error) {
    console.log('Jev failed', response.debug?.jevFailure ?? response.error);
  }
  console.log('decision', {
    response: { ...response, debug: undefined },
    thresholds: response.debug?.thresholds,
  });
  console.groupEnd();
}

export function logFallback(reason: string): void {
  if (!ENABLED) return;
  console.log(`${TAG} no direct route (${reason}); falling back to clicking through the screen`);
}
