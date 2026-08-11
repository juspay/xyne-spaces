export { intentClassifier, isEligible, type ClassifiableChannel } from './intentClassifier';
export { INTENTS, PROTOTYPES_VERSION, getIntent, type IntentId, type IntentSpec } from './intents';
export {
  MIN_INTENT_SCORE,
  UNCLASSIFIED,
  prefilter,
  type IntentScore,
  type ScoreResult,
} from './scoring';
export { CANDIDATE_THRESHOLD, INTENT_TRIGGER_ENABLED, MODEL_VERSION } from './config';
export type { ClassificationResult } from './intent.worker';
