export const PROMPT_FULL_REPLACEMENT_MAX_CHARS = 8_000;

interface PromptEdit {
  oldText?: unknown;
  newText?: unknown;
}

export type PromptResolution =
  | { prompt: string; error?: undefined }
  | { prompt?: undefined; error: string }
  | { prompt?: undefined; error?: undefined };

export function resolvePromptChange(
  params: Record<string, unknown>,
  currentPrompt: string,
): PromptResolution {
  const fullReplacement =
    typeof params['systemPrompt'] === 'string' ? params['systemPrompt'].trim() : '';
  const rawEdits = params['promptEdits'];

  if (fullReplacement && rawEdits !== undefined) {
    return {
      error:
        'Provide either systemPrompt (full replacement) or promptEdits (anchored edits), not both.',
    };
  }

  if (rawEdits !== undefined) {
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return { error: 'promptEdits must be a non-empty array of {oldText, newText}.' };
    }
    let working = currentPrompt;
    for (let i = 0; i < rawEdits.length; i++) {
      const edit = rawEdits[i] as PromptEdit | null;
      const oldText = typeof edit?.oldText === 'string' ? edit.oldText : '';
      const newText = typeof edit?.newText === 'string' ? edit.newText : '';
      if (!oldText) return { error: `promptEdits[${i}].oldText is required.` };
      const first = working.indexOf(oldText);
      if (first === -1) {
        return { error: `promptEdits[${i}].oldText not found in the current instructions.` };
      }
      if (working.indexOf(oldText, first + 1) !== -1) {
        return { error: `promptEdits[${i}].oldText matches more than once.` };
      }
      working = working.slice(0, first) + newText + working.slice(first + oldText.length);
    }
    if (!working.trim()) return { error: 'promptEdits would leave the instructions empty.' };
    return { prompt: working };
  }

  if (fullReplacement) {
    if (currentPrompt.length > PROMPT_FULL_REPLACEMENT_MAX_CHARS) {
      return {
        error: `The current instructions are ${currentPrompt.length} chars — too large for full replacement. Anchored edits are required.`,
      };
    }
    return { prompt: fullReplacement };
  }

  return {};
}
