import type { AgentsConfig } from '@/agents/config';
import { configuredEngine } from './targets';
import type { DecisionEngine, TaskFeature } from './types';

/**
 * Each feature's own CAC switch: on => the configured engine (DECISION_ENGINE) answers live,
 * off => the feature's LLM. The keys keep their original xor names so stored configs still apply.
 */
const ENGINE_SWITCHES: Record<TaskFeature, (config: AgentsConfig) => boolean> = {
  email_category: (config) => config.classificationXorEnabled,
  email_priority: (config) => config.priorityClassificationXorEnabled,
};

/** The engine that answers `feature` live; the LLM takes over when it gives no answer. */
export const primaryEngine = (feature: TaskFeature, agentsConfig: AgentsConfig): DecisionEngine =>
  ENGINE_SWITCHES[feature](agentsConfig) ? configuredEngine() : 'llm';
