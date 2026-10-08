import { describe, expect, it } from "vitest";
import { hasInteractiveCardSurface } from "../src/card-surface.js";

const emitter = { emit: () => {} };

describe("hasInteractiveCardSurface", () => {
  it("channel thread runs have a card surface", () => {
    expect(hasInteractiveCardSurface({ channelId: "ch-1", progressUrl: "http://x/progress", cardSurface: undefined })).toBe(true);
  });
  it("live sidebar runs (emitter progress) have a card surface", () => {
    expect(hasInteractiveCardSurface({ channelId: undefined, progressUrl: emitter, cardSurface: undefined })).toBe(true);
  });
  it("Xyne AI continuation runs (URL progress + marker) have a card surface", () => {
    expect(
      hasInteractiveCardSurface({
        channelId: undefined,
        progressUrl: "http://xyne-claw-auth/internal/agent-chat/ask-ai/chat/c/progress",
        cardSurface: "xyne-ai",
      }),
    ).toBe(true);
  });
  it("a plain URL progress (automation / headless) is NOT a card surface", () => {
    expect(hasInteractiveCardSurface({ channelId: undefined, progressUrl: "http://x/progress", cardSurface: undefined })).toBe(false);
    expect(hasInteractiveCardSurface({ channelId: undefined, progressUrl: "http://x/progress", cardSurface: "other" })).toBe(false);
  });
});
