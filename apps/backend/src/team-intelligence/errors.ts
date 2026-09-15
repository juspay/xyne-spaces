/**
 * Thrown when the team-intelligence summary pipeline cannot use the LLM
 * (no credential configured, or all retries of an LLM call exhausted).
 *
 * The summary services are LLM-only: they do NOT silently fall back to
 * deterministic/rule-based output. When this error is thrown, the worker
 * catches it, marks the job FAILED, and passes ahead so the next pipeline
 * stage (team → org) can still proceed with whatever completed.
 */
export class TeamIntelligenceLLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamIntelligenceLLMUnavailableError';
  }
}
