/**
 * What Spaces routes channel questions nobody tagged by, `agents.config.proactivity`:
 * the owner's own text, or the card generated from the prompt and tools.
 *
 * Whether and when an agent answers is decided by the Spaces backend's proactivity
 * policy, which reads this through the agent list. Any agent whose bot is in a channel
 * that turned it on can answer there; the channel's mode is the only switch.
 *
 * Named agent-proactivity rather than proactive/: that folder is the Gmail open-loops
 * nudge pipeline, a different thing.
 */

export const PROACTIVITY_DESCRIPTION_MAX = 500;
/** Same cap as xyne-claw's routing-card.ts. */
export const ROUTING_CARD_MAX = 2000;

export interface GeneratedCard {
  text: string;
  /** Hash of what it was written from; a new one regenerates it (card.ts). */
  sourceHash: string;
  generatedAt: string;
}

export interface ProactivityConfig {
  /** What routing reads: the owner's own text if they wrote one, else the generated card. */
  description: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function readGeneratedCard(agentConfig: unknown): GeneratedCard | null {
  const raw = isPlainObject(agentConfig) ? agentConfig["proactivity"] : undefined;
  const card = isPlainObject(raw) ? raw["generated"] : undefined;
  if (!isPlainObject(card) || !trimmed(card["text"])) return null;
  return {
    text: trimmed(card["text"]),
    sourceHash: trimmed(card["sourceHash"]),
    generatedAt: trimmed(card["generatedAt"]),
  };
}

/** Empty until the card is written: routing skips an agent with nothing to match on. */
export function resolveProactivityConfig(agentConfig: unknown): ProactivityConfig {
  const raw = isPlainObject(agentConfig) ? agentConfig["proactivity"] : undefined;
  if (!isPlainObject(raw)) return { description: "" };
  return { description: trimmed(raw["description"]) || readGeneratedCard(agentConfig)?.text || "" };
}

/** Write-time check, next to validateAwakeningConfig. */
export function validateProactivityConfig(
  config: Record<string, unknown> | undefined,
): { ok: true } | { ok: false; error: string } {
  const raw = config?.["proactivity"];
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) return { ok: false, error: "proactivity must be an object" };
  if (raw["description"] !== undefined && typeof raw["description"] !== "string") {
    return { ok: false, error: "proactivity.description must be a string" };
  }
  if (trimmed(raw["description"]).length > PROACTIVITY_DESCRIPTION_MAX) {
    return { ok: false, error: `proactivity.description must be at most ${PROACTIVITY_DESCRIPTION_MAX} characters` };
  }
  const generated = raw["generated"];
  if (generated !== undefined && (!isPlainObject(generated) || trimmed(generated["text"]).length > ROUTING_CARD_MAX)) {
    return { ok: false, error: `proactivity.generated must be an object with text of at most ${ROUTING_CARD_MAX} characters` };
  }
  return { ok: true };
}
