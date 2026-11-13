/**
 * Node-path addressing for durable pause/resume.
 *
 * Every executing step — top-level or nested inside any control-flow branch —
 * has a stable, content-addressed key derived from the chain of branch frames
 * that enclose it. This key is the step's persisted `stepName`, so a step's
 * record is the single source of truth for its state (completed / parked /
 * awaiting review). Resume routes a payload to a step by this key; the walk
 * memoizes completed steps by this key. No positional indices, no separate
 * pause cursor.
 *
 * Grammar:
 *   record key   = stepId                              (top level)
 *                | <framePrefix>/stepId                (inside a branch)
 *   frame prefix = <controlStepKey>:<branchKey>#<iter>
 *   controlStepKey = the record key of the enclosing control-flow step
 *
 * Examples:
 *   "extract"                                  top-level step
 *   "parallel_x:swot#0/inner1"                 step in PARALLEL branch "swot"
 *   "loop_y:body#3/summarize"                  step in LOOP iteration 3
 *   "parallel_x:swot#0/loop_z:body#2/deep"     arbitrarily nested
 *
 * Because the key is computed structurally from the workflow definition, it is
 * identical on every walk — which is what makes memoized resume work at any
 * depth, and lets two concurrent gates (different keys) resume independently.
 */

/** The record key (persisted `stepName`) for a step at the given scope prefix. */
export function recordKey(prefix: string, stepId: string): string {
  return prefix ? `${prefix}/${stepId}` : stepId;
}

/**
 * The scope prefix for a branch frame: a `<branchKey>#<iter>` frame qualified by
 * the enclosing control step's own record key. `iter` distinguishes LOOP
 * iterations (always 0 for single-branch control steps).
 */
export function framePrefix(
  parentPrefix: string,
  controlStepId: string,
  branchKey: string,
  iter: number,
): string {
  return `${recordKey(parentPrefix, controlStepId)}:${branchKey}#${String(iter)}`;
}

/**
 * The bare step id at the end of a record key — the last path segment, stripped
 * of any frame qualifier. Used to map a paused record back to its config step
 * (e.g. for the approvals queue display) and for SSE event keying.
 *
 *   "extract"                              -> "extract"
 *   "parallel_x:swot#0/gate"               -> "gate"
 *   "loop_y:body#3/agent_summarize"        -> "agent_summarize"
 */
export function leafStepId(recordName: string): string {
  const lastSegment = recordName.slice(recordName.lastIndexOf('/') + 1);
  // A leaf segment is a bare step id; a frame segment (which never appears last)
  // would contain ':'. Guard anyway by trimming a frame qualifier if present.
  const colon = lastSegment.indexOf(':');
  return colon >= 0 ? lastSegment.slice(0, colon) : lastSegment;
}
