/**
 * Whether a run has a surface that can render interactive cards (draft-agent
 * approval, connector suggestions) for a human to act on.
 *
 * - A Spaces channel thread (`channelId`).
 * - The live Xyne AI sidebar stream (progress is an in-process emitter, not a URL).
 * - A Xyne AI continuation run (after a question card is answered). Its
 *   progress is a URL like a headless run's, so claw-auth marks it with
 *   `cardSurface: "xyne-ai"`. claw-auth forwards that marker only for internal
 *   S2S callers (lib/start-run.ts), and claw's /run itself is S2S-only.
 *
 * A plain string progressUrl alone is NOT enough — automation and scheduled
 * runs use one too, and nobody is there to approve a card.
 */
export function hasInteractiveCardSurface(input: {
  channelId: string | undefined | null;
  progressUrl: unknown;
  cardSurface: string | undefined | null;
}): boolean {
  if (input.channelId) return true;
  if (input.progressUrl && typeof input.progressUrl !== "string") return true;
  return input.cardSurface === "xyne-ai";
}
