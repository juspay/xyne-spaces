/**
 * Anchored prompt editing for the agent-authoring write tools (update-agent /
 * update-subagent). Mirrors the skill-update mechanism in routes/skills.ts: a
 * long body does not survive as a tool argument (truncation destroys it), so
 * full-body replacement is only allowed while the CURRENT prompt is short;
 * larger prompts must be changed via {oldText, newText} anchored edits, each
 * anchor copied exactly and unique within the prompt.
 */

export const PROMPT_FULL_REPLACEMENT_MAX_CHARS = 8_000;

export interface PromptEdit {
  oldText?: unknown;
  newText?: unknown;
}

export type PromptResolution =
  | { prompt: string; error?: undefined }
  | { prompt?: undefined; error: string }
  | { prompt?: undefined; error?: undefined };

/**
 * Resolve the requested prompt change from tool params against the currently
 * stored prompt. Returns:
 *  - {} when neither systemPrompt nor promptEdits was supplied (no change),
 *  - { prompt } with the new full prompt to store,
 *  - { error } when the request is invalid (both modes at once, bad anchors,
 *    or a full replacement of a prompt too large to round-trip safely).
 */
export function resolvePromptChange(
  params: Record<string, unknown>,
  currentPrompt: string,
): PromptResolution {
  const fullReplacement = typeof params["systemPrompt"] === "string" ? (params["systemPrompt"] as string).trim() : "";
  const rawEdits = params["promptEdits"];

  if (fullReplacement && rawEdits !== undefined) {
    return { error: "Provide either systemPrompt (full replacement) or promptEdits (anchored edits), not both." };
  }

  if (rawEdits !== undefined) {
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return { error: "promptEdits must be a non-empty array of {oldText, newText}." };
    }
    let working = currentPrompt;
    for (let i = 0; i < rawEdits.length; i++) {
      const edit = rawEdits[i] as PromptEdit | null;
      const oldText = typeof edit?.oldText === "string" ? edit.oldText : "";
      const newText = typeof edit?.newText === "string" ? edit.newText : "";
      if (!oldText) return { error: `promptEdits[${i}].oldText is required.` };
      const first = working.indexOf(oldText);
      if (first === -1) {
        return {
          error:
            `promptEdits[${i}].oldText not found in the current prompt — copy it EXACTLY ` +
            "(read the current prompt first; it may have changed since you read it).",
        };
      }
      if (working.indexOf(oldText, first + 1) !== -1) {
        return {
          error: `promptEdits[${i}].oldText matches more than once — include more surrounding context to make it unique.`,
        };
      }
      working = working.slice(0, first) + newText + working.slice(first + oldText.length);
    }
    if (!working.trim()) return { error: "promptEdits would leave the prompt empty." };
    return { prompt: working };
  }

  if (fullReplacement) {
    if (currentPrompt.length > PROMPT_FULL_REPLACEMENT_MAX_CHARS) {
      return {
        error:
          `The current prompt is ${currentPrompt.length} chars — too large for full-replacement mode ` +
          "(tool arguments get truncated and would destroy it). Use promptEdits " +
          "({oldText, newText} anchored replacements) instead.",
      };
    }
    return { prompt: fullReplacement };
  }

  return {};
}
