export {
  intentClassifier,
  isEligible,
  type ClassifiableChannel,
  type IntentDetection,
  type ModelStatus,
} from './intentClassifier';
export {
  INTENTS,
  PROTOTYPES_VERSION,
  getIntent,
  type HelpTopicSpec,
  type IntentId,
  type IntentSpec,
} from './intents';
export {
  MIN_INTENT_SCORE,
  TOPIC_FLOOR,
  TOPIC_MARGIN,
  UNCLASSIFIED,
  UNRESOLVED_TOPIC,
  prefilter,
  type IntentScore,
  type ScoreResult,
  type TopicResult,
  type TopicScore,
} from './scoring';
export { CANDIDATE_THRESHOLD, INTENT_TRIGGER_ENABLED, MODEL_VERSION } from './config';
export type { ClassificationResult } from './intent.worker';
