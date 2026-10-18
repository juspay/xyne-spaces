import { config as envConfig } from '@/config/env';
import { isJevConfigured, isPrivateJevConfigured } from './classifierClient';
import type { ClassifierTarget } from './types';
import { isLlmDecisionConfigured } from './llmDecision';
import type { ClassifierEngine, DecisionEngine } from './types';

/** The engine that answers typed decision questions live: DECISION_ENGINE. */
export const configuredEngine = (): ClassifierEngine => envConfig.decisionEngine;

/** XOR_* when XOR_URL is set; otherwise JEV_*, which is where XOR lived before XOR_* existed. */
const xorTarget = (): ClassifierTarget => (envConfig.xor.url ? envConfig.xor : envConfig.jev);

/** Where a classifier engine is called. */
export const classifierTarget = (engine: ClassifierEngine): ClassifierTarget =>
  engine === 'xor' ? xorTarget() : envConfig.jev;

/**
 * Whether `engine` can answer. With `customerContent`, it must also be the deployer's own: XOR or
 * Jev pointed at explicitly (never the public default endpoint), or their own LiteLLM.
 */
export const isEngineConfigured = (
  engine: DecisionEngine,
  { customerContent = false }: { customerContent?: boolean } = {}
): boolean => {
  if (engine === 'llm') return isLlmDecisionConfigured();
  if (engine === 'jev') return customerContent ? isPrivateJevConfigured() : isJevConfigured();
  if (envConfig.xor.url) return Boolean(envConfig.xor.apiKey);
  return customerContent ? isPrivateJevConfigured() : isJevConfigured();
};

export const isDecisionEngineConfigured = (): boolean => isEngineConfigured(configuredEngine());

/** Required before a decision about customer content. */
export const isPrivateDecisionEngineConfigured = (): boolean =>
  isEngineConfigured(configuredEngine(), { customerContent: true });

/** The model behind the configured engine, for logs. */
export const decisionEngineModel = (): string => classifierTarget(configuredEngine()).model;

/** Two classifier engines on one endpoint and model, as JEV_* is while it stands in for XOR. */
export const isSameClassifier = (a: DecisionEngine, b: DecisionEngine): boolean => {
  if (a === b) return true;
  if (a === 'llm' || b === 'llm') return false;
  const x = classifierTarget(a);
  const y = classifierTarget(b);
  return x.url === y.url && x.model === y.model;
};

/**
 * Whether `engine` can be asked alongside `liveEngine` to compare them: the deployer's own and
 * configured (evaluations carry customer content), and not `liveEngine` under another name.
 */
export const isComparisonEngineAvailable = (engine: DecisionEngine, liveEngine: DecisionEngine): boolean =>
  isEngineConfigured(engine, { customerContent: true }) && !isSameClassifier(engine, liveEngine);
