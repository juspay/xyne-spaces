import type { AgentsConfig } from '@/agents/config';
import { recordRun } from '@/services/otel/decisionMetrics';
import { runEngine } from './engines';
import { evaluateInBackground } from './evaluation';
import { primaryEngine } from './routes';
import type { DecisionTask, EngineRun } from './types';

export interface DecideOptions {
  agentsConfig: AgentsConfig;
  /** Queue the decision for the other engines to compare; off for e.g. a settings-page preview. */
  evaluate?: boolean;
}

/**
 * The live answer to `task`: the feature's primary engine, then the LLM when that gives none.
 * Null when nothing answered. Throws only what the LLM threw when it was the live engine,
 * so callers keep the failure handling they had before.
 */
export async function decide<T>(task: DecisionTask<T>, { agentsConfig, evaluate = false }: DecideOptions): Promise<T | null> {
  const primary = primaryEngine(task.feature, agentsConfig);

  const runs: EngineRun<T>[] = [await runEngine(primary, task)];
  if (runs[0].answer === null && primary !== 'llm') {
    runs.push(await runEngine('llm', task));
  }
  for (const run of runs) {
    if (run.outcome !== 'unavailable') recordRun(task.feature, run, 'live');
  }

  if (evaluate) evaluateInBackground(task, runs);

  const live = runs[runs.length - 1];
  if (live.outcome === 'failed' && live.engine === 'llm') throw live.error;
  return live.answer;
}
