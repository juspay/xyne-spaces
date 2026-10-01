import type { TwinDeliveryCheck } from "xyne-claw-shared";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/**
 * One plain line for the owner's "Why?" panel summarising claw's classifier
 * self-check of a twin draft. Null when there is no check. Advisory only.
 */
export function formatTwinCheck(check: TwinDeliveryCheck | undefined): string | null {
  if (!check || typeof check.overall !== "number") return null;
  const parts: string[] = [];
  if (typeof check.answersAsk === "number") parts.push(`answers the ask ${pct(check.answersAsk)}`);
  if (typeof check.grounded === "number") parts.push(`grounded ${pct(check.grounded)}`);
  if (typeof check.actionFits === "number") parts.push(`action fits ${pct(check.actionFits)}`);
  if (check.destination) parts.push(`destination ${check.destination}`);
  if (parts.length === 0) return null;
  const flag = check.overall < 0.4 ? " — low confidence, review carefully" : "";
  return `Self-check: ${parts.join(" · ")}${flag}`;
}

/** Reasoning with the self-check line appended (or the line alone). */
export function reasoningWithCheck(reasoning: string | undefined, check: TwinDeliveryCheck | undefined): string | undefined {
  const line = formatTwinCheck(check);
  if (!line) return reasoning;
  return reasoning?.trim() ? `${reasoning.trimEnd()}\n\n${line}` : line;
}
