/**
 * Session-level heuristic filter — runs BEFORE the LLM curator.
 *
 * Purpose: kill obvious junk (greetings, meta-questions, chit-chat, errored
 * sessions, transcript dumps that won't yield memories) before we burn
 * curator LLM tokens on them. The curator is what decides actual memory
 * candidates; this is the cheap pre-filter.
 *
 * Bias: aggressive rejection. Cost of over-including is one curator LLM call.
 * Cost of over-excluding is one approve-by-hand if the admin disagrees with
 * a heuristic drop. Skipped sessions are still surfaced in batch.heuristicSkipped
 * with reasons, so admins can spot-check the filter.
 */

export interface TranscriptForHeuristic {
  sessionId: string;
  task: string;
  result: string;
  toolsUsed: string[];
  tokensIn: number;
  tokensOut: number;
}

export interface HeuristicVerdict {
  include: boolean;
  /** Present when include=false; surfaced to admin in heuristicSkipped JSON. */
  reason?: string;
}

const MIN_TASK_CHARS = 15;
const MIN_RESULT_CHARS_ANY = 100;
const MIN_RESULT_CHARS_WITHOUT_REAL_TOOLS = 400;

/**
 * Tools that aren't "real work" — they deliver an answer / collect info but
 * don't themselves produce learnable signal. A session that ONLY uses these
 * is treated as no-tool for filtering.
 */
const NON_WORK_TOOLS = new Set([
  "respond-to-user",
  "respond_to_user",
  "ask-question",
  "ask_user_question",
  "attachment",
  "send-attachment",
]);

const GREETING_RE = /^\s*(hi|hello|hey|yo|hola|sup|gm|good\s+(morning|afternoon|evening))[\s!.?]*$/i;
const ERROR_RE = /^\s*(error|exception|failed|timeout|cancelled):/i;

/**
 * Meta-questions the user asks the agent itself — not real work for the agent
 * to remember. "Which agent are you", "what can you do", "how long is this
 * taking", "explain <thing>".
 */
const META_RE =
  /^(which|what|who|how)\s+(agent|are\s+you|can\s+you|is\s+this|long)|^explain\s+\w+\s*$|taking\s+so\s+long|^who\s+made\s+you/i;

/**
 * Spaces-thread tasks that land on the wrong agent (typically Doctor sees
 * "remind X about Y", "tag respective devs", "summarize this thread" — these
 * are spaces-thread chores, not bug-investigation work).
 */
const SPACES_THREAD_TASK_RE =
  /\b(remind|notify|tag|message|ping)\s+\S+\s+(about|that|to)\b|\bsummariz(e|ing)\s+(this|the)\s+thread\b/i;

/** Strip @mentions and <@user_id> tags before pattern-matching the task. */
function stripMentions(s: string): string {
  return s.replace(/<@[A-Za-z0-9_-]+>/g, "").replace(/@\S+/g, "").trim();
}

export function shouldReviewSession(t: TranscriptForHeuristic): HeuristicVerdict {
  const stripped = stripMentions(t.task);

  if (!stripped || stripped.length < MIN_TASK_CHARS) {
    return { include: false, reason: "task is empty / too short after stripping mentions" };
  }

  if (!t.result || t.result.trim().length < MIN_RESULT_CHARS_ANY) {
    return { include: false, reason: "agent response was empty or trivially short" };
  }

  if (GREETING_RE.test(stripped)) {
    return { include: false, reason: "task was a greeting (after mention strip)" };
  }

  if (ERROR_RE.test(t.result.trim())) {
    return { include: false, reason: "agent terminated in an error state" };
  }

  if (META_RE.test(stripped)) {
    return { include: false, reason: "meta question about the agent (not real work)" };
  }

  if (SPACES_THREAD_TASK_RE.test(stripped)) {
    return { include: false, reason: "looks like a spaces-thread task (remind/tag/notify), not agent work" };
  }

  // Real-work tool count — tools that actually moved the world, ignoring
  // delivery-only tools like respond-to-user / attachment.
  const realWorkTools = t.toolsUsed.filter((x) => !NON_WORK_TOOLS.has(x));

  if (realWorkTools.length > 0) {
    return { include: true };
  }

  // No real-work tools fired. A long agent response can still hold a useful
  // codebase explanation / reasoning, but anything shorter is chit-chat.
  if (t.result.trim().length < MIN_RESULT_CHARS_WITHOUT_REAL_TOOLS) {
    return { include: false, reason: "no real-work tools used and response under 400 chars" };
  }

  return { include: true };
}
