/**
 * Follow-up questions and one-tap suggestions for the Build chat, as the model
 * writes them, made safe to show: lengths capped, duplicates and the options
 * the card adds itself ("Something else", "Skip") removed, anything malformed
 * dropped. An empty result means the turn falls back to plain text.
 */
import type { DraftQuestion, DraftSuggestion } from "xyne-claw-shared";

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;
const MAX_SUGGESTIONS = 2;
/** The card adds these itself. */
const CARD_OPTIONS = /^(other|something else|none of (these|the above)|skip|not sure)\b/i;

const clip = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** A question's chip: whole words only, at most 16 characters ("Weather capability" → "Weather"). */
function chipLabel(value: unknown): string {
  const words = clip(value, 60).split(" ").filter(Boolean);
  let label = "";
  for (const word of words) {
    const next = label ? `${label} ${word}` : word;
    if (next.length > 16) break;
    label = next;
  }
  return label || (words[0] ?? "").slice(0, 16);
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export function normalizeQuestions(raw: unknown): DraftQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: DraftQuestion[] = [];
  for (const item of raw) {
    const q = record(item);
    if (!q) continue;
    const question = clip(q["question"], 200);
    const label = chipLabel(q["label"] ?? q["header"]);
    if (!question || !label) continue;
    const seen = new Set<string>();
    const options: DraftQuestion["options"] = [];
    for (const rawOption of Array.isArray(q["options"]) ? q["options"] : []) {
      const o = typeof rawOption === "string" ? { label: rawOption } : record(rawOption);
      if (!o) continue;
      const optionLabel = clip(o["label"], 40);
      const key = optionLabel.toLowerCase();
      if (!optionLabel || CARD_OPTIONS.test(optionLabel) || seen.has(key)) continue;
      seen.add(key);
      const description = clip(o["description"], 90);
      options.push(description ? { label: optionLabel, description } : { label: optionLabel });
      if (options.length === MAX_OPTIONS) break;
    }
    if (options.length < 2) continue;
    const multi = q["type"] === "multiple_choice" || q["multiSelect"] === true;
    questions.push({
      id: `q${questions.length + 1}`,
      label,
      question,
      type: multi ? "multiple_choice" : "single_choice",
      options,
    });
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions;
}

export function normalizeSuggestions(raw: unknown): DraftSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: DraftSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = record(item);
    if (!s) continue;
    const label = clip(s["label"], 48).replace(/[.!]+$/, "");
    const message = clip(s["message"], 300);
    if (!label || !message || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    suggestions.push({ id: `s${suggestions.length + 1}`, label, message });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
