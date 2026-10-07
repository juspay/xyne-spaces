import { getApiErrorMessage } from '../../../utils/apiError';
import { diagnose } from '../../Voice/diagnoseLog';
import {
  fillTemplate,
  hasValue,
  holds,
  type ActionDefinition,
  type FieldValue,
} from '../actions/action';
import {
  FORMS,
  operableForms,
  type FormId,
  type OperableField,
  type OperableForm,
} from '../forms/operableForm';
import type { PageId } from '../pages';
import type { TaskId } from '../tasks';
import type { EngineState } from './dialogue';
import { lowerFirst } from './text';

/**
 * Runs an action's plan on the page, as the user would: open it, fill the fields in front of
 * them, press the page's own buttons; a step with no page is handed to its task (tasks.ts). It
 * stops at the first failure, never retries, and never submits twice; what it could not do is
 * told, not thrown.
 */
// `refused`: the server or the page turned it down (a 4xx, a rule, a permission), which trying
// again cannot change; otherwise it may have been a passing failure, worth another try.
export type RunResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; refused?: boolean };

const FORM_WAIT_MS = 4000;
// Checks the page runs while the user types (a name's availability) may still be under way.
const CHECK_WAIT_MS = 5000;
const CHECK_POLL_MS = 200;
// Long enough for the user to see each field fill, and for the page to settle after a change.
const STEP_PAUSE_MS = 400;

const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, STEP_PAUSE_MS));

type Values = Record<string, FieldValue>;

// Writes the values the form does not hold yet, highlighting each as it fills. `stopped` is asked
// before each field, so a stop is felt within one field's pause.
async function fill(
  id: FormId,
  form: () => Promise<OperableForm>,
  values: Values,
  stopped: () => boolean,
): Promise<void> {
  for (const [field, value] of Object.entries(values)) {
    if (stopped()) return;
    const target = (await form()).fields[field];
    if (!target || !hasValue(value) || target.get() === value) continue;
    operableForms.setFilling({ form: id, field });
    diagnose('Fill', field);
    target.set(value);
    await pause();
  }
}

// The live preview under way. A run waits for it, so the two never write to the page together.
let progress: Promise<void> = Promise.resolve();

async function preview(
  action: ActionDefinition,
  values: Values,
  openPage: (page: PageId) => void,
  stopped: () => boolean,
): Promise<void> {
  const step = action.plan.find(s => s.op === 'fill');
  if (step?.op !== 'fill') return;
  const id = step.form;
  try {
    if (!operableForms.get(id)) openPage(FORMS[id].page);
    const form = await operableForms.waitFor(id, FORM_WAIT_MS);
    await fill(id, () => Promise.resolve(operableForms.get(id) ?? form), values, stopped);
  } catch {
    // The page did not open in time; the run will open it again or explain.
  } finally {
    operableForms.setFilling(null);
  }
}

/**
 * Shows the request on its page while the dialogue is still collecting: opens the form and fills
 * what is known so far, so the user watches it build up. Never submits; best effort. `stopped` is
 * the caller's check that the request is no longer the one in hand, which ends the fill.
 */
export function showProgress(
  action: ActionDefinition,
  values: Values,
  openPage: (page: PageId) => void,
  stopped: () => boolean = () => false,
): Promise<void> {
  progress = progress.then(() => preview(action, values, openPage, stopped));
  return progress;
}

// The first field the form refuses, once the checks still running have finished; without a field
// when they have not finished in time.
async function refusal(id: FormId): Promise<{ field?: string; error: string } | null> {
  const fields = (): [string, OperableField][] =>
    Object.entries(operableForms.get(id)?.fields ?? {});
  const until = Date.now() + CHECK_WAIT_MS;
  while (fields().some(([, target]) => target.checking?.())) {
    if (Date.now() >= until) {
      return {
        error: 'The page is still checking, so nothing was submitted. Try again in a moment.',
      };
    }
    await new Promise(resolve => setTimeout(resolve, CHECK_POLL_MS));
  }
  for (const [field, target] of fields()) {
    const error = target.validate?.();
    if (error) return { field, error };
  }
  return null;
}

const STOPPED: RunResult = { ok: false, error: 'Stopped. Nothing more was done.' };

// What a failure is told as. The server refusing the user's role reads as that, whatever its words.
const failureOf = (error: unknown, { title }: ActionDefinition): string =>
  statusOf(error) === 403
    ? `You don't have permission to ${lowerFirst(title)}.`
    : getApiErrorMessage(error, 'Something went wrong.');

const statusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

// A trouble of the run itself (the page closed or was slow), which another try may get past.
const passing = (message: string): Error => Object.assign(new Error(message), { passing: true });

// Statuses that say "not now" rather than "no": a timeout, too many requests, the server failing.
const TRY_LATER = new Set([408, 429]);

/**
 * Whether trying again cannot help: a status the server answered with that is not a passing one,
 * or a page's or task's own refusal (a rule, a permission). A request that got no answer (the
 * network, a timeout) and the run's own troubles may pass.
 */
function isRefusal(error: unknown): boolean {
  if ((error as { passing?: boolean } | null)?.passing) return false;
  const status = statusOf(error);
  if (status !== undefined) return status < 500 && !TRY_LATER.has(status);
  const { isAxiosError, code } = (error ?? {}) as { isAxiosError?: boolean; code?: string };
  return !isAxiosError && !code && error instanceof Error;
}

/**
 * `signal` stops the run between steps and between fields, never in the middle of one. `onSubmit` is called just
 * before the submit is sent: from then on the caller no longer aborts, so a run is either stopped
 * with nothing submitted or carried through. A `perform` step is as irreversible as a submit.
 */
export async function runPlan(
  state: EngineState,
  openPage: (page: PageId, params?: Record<string, string>) => void,
  perform: (task: TaskId, state: EngineState) => Promise<void>,
  signal: AbortSignal,
  onSubmit: () => void,
): Promise<RunResult> {
  const { action, values, resolved } = state;
  await progress;
  const seen = new Set<FormId>();

  // The form on its page, opening the page when it is not there. One that was there and is
  // gone means the user left the page, so the run stops.
  const formOf = async (id: FormId): Promise<OperableForm> => {
    const live = operableForms.get(id);
    if (live) {
      seen.add(id);
      return live;
    }
    if (seen.has(id)) {
      throw passing('The page was closed, so I stopped. Nothing was submitted.');
    }
    diagnose('Run', `opening ${FORMS[id].page}`);
    openPage(FORMS[id].page);
    let form: OperableForm;
    try {
      form = await operableForms.waitFor(id, FORM_WAIT_MS);
    } catch {
      diagnose('Run', `${id} did not open in ${FORM_WAIT_MS} ms`);
      throw passing(
        `I couldn't fill the page in myself. ${action.guide?.[0] ?? 'Please do it there.'}`,
      );
    }
    // Stopped while the page was opening: nothing is written to it.
    signal.throwIfAborted();
    seen.add(id);
    return form;
  };

  try {
    for (const step of action.plan) {
      if (signal.aborted) return STOPPED;
      if (!holds(step.if, values)) continue;
      switch (step.op) {
        case 'open_page': {
          // A param that fills to nothing was not said, so it stays out of the URL.
          const params = Object.entries(step.params ?? {})
            .map(([key, template]) => [key, fillTemplate(template, values, resolved)] as const)
            .filter(([, value]) => value);
          openPage(step.page, Object.fromEntries(params));
          break;
        }
        case 'fill':
          await fill(
            step.form,
            () => formOf(step.form),
            values,
            () => signal.aborted,
          );
          break;
        case 'run_action': {
          const form = await formOf(step.form);
          const run = form.actions?.[step.action];
          if (!run) throw new Error(`I can't do that on this page.`);
          diagnose('Run', `action ${step.action}`);
          await run();
          await pause();
          break;
        }
        case 'submit': {
          await formOf(step.form);
          const problem = await refusal(step.form);
          if (problem) return { ok: false, ...problem };
          // Again, so its handlers are those of the page as it is now.
          const form = await formOf(step.form);
          if (form.busy?.()) throw passing('It is already being submitted.');
          // The checks above took time: the last chance to stop.
          if (signal.aborted) return STOPPED;
          diagnose('Run', 'submit');
          onSubmit();
          await form.submit();
          break;
        }
        case 'perform': {
          diagnose('Run', `perform ${step.task}`);
          onSubmit();
          await perform(step.task, state);
          break;
        }
      }
    }
    // A fill that was stopped ends the loop without a failure of its own.
    return signal.aborted ? STOPPED : { ok: true };
  } catch (error) {
    // Whatever the stop interrupted, it is a stop.
    if (signal.aborted) return STOPPED;
    return {
      ok: false,
      error: failureOf(error, action),
      ...(isRefusal(error) && { refused: true }),
    };
  } finally {
    operableForms.setFilling(null);
  }
}
