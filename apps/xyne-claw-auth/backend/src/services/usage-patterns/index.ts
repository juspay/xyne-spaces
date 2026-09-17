/**
 * Usage-pattern pipeline.
 *
 *   extract    →  runs become a bounded corpus        (extract.ts)
 *   redact     →  identifiers become placeholders     (redact.ts, pure)
 *   synthesize →  corpus becomes a file and an index blob (synthesize.ts)
 *   render     →  surviving patterns become the text  (render.ts, pure)
 *
 * The file is stored as a shared AgentMemoryFile so a human can correct it, and
 * mirrored into the agent index as `kind:usage` so routing can search it.
 */
export {
  assembleCorpus,
  delegationSamples,
  distinctUsers,
  extractCorpus,
  summarizeTools,
  toSample,
  userRef,
  MAX_SAMPLES,
  MAX_TASK_CHARS,
} from "./extract.js";
export type { CallerRow, RunRow } from "./extract.js";
export { PLACEHOLDER, redactCorpus, redactSample, redactText } from "./redact.js";
export { renderUsageFile, MAX_TEXT_CHARS } from "./render.js";
export {
  enforceThresholds,
  getUsagePatternFile,
  writeUsagePatternFile,
  synthesizeUsagePatterns,
  synthesizeUsagePatternsBestEffort,
  startUsagePatternSynthesis,
  usagePatternJob,
  FILE_NAME,
  UPDATED_BY,
} from "./synthesize.js";
export type { UsagePatternJob } from "./synthesize.js";
export type {
  DistilledPattern,
  PatternKind,
  RunRating,
  RunStatus,
  SkipReason,
  SynthesisOutcome,
  ToolUsage,
  UsageCorpus,
  UsagePattern,
  UsagePatternFile,
  UsageSample,
  UsageWindow,
} from "./types.js";
