export interface ClawApprovedAction {
  tool: string;
  result?: string;
  error?: string;
}

const APPROVED_RESULT_LIMIT = 5_000;

export function approvedActionInstructions(action: ClawApprovedAction): string {
  if (action.error !== undefined) {
    return [
      'The user approved a write action from this chat, but it failed.',
      `- Tool: ${action.tool}`,
      `- Error: ${action.error.trim() || 'Unknown error'}`,
      'Explain the failure to the user in plain words and say exactly which value they need to change to retry.',
      'Do not call tools in this turn.',
    ].join('\n');
  }
  const result = (action.result ?? '').trim();
  const capped =
    result.length > APPROVED_RESULT_LIMIT
      ? `${result.slice(0, APPROVED_RESULT_LIMIT)}\n... (truncated)`
      : result;
  return [
    'The user approved the write action you proposed in this chat, and it ran.',
    `- Tool: ${action.tool}`,
    'Continue the reply from the approved result below: say briefly what was done and the next best step.',
    'Do not call tools and do not ask for another approval in this turn.',
    `Approved result:\n${capped || '(empty output)'}`,
  ].join('\n');
}
