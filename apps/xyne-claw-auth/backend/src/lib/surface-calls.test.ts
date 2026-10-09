import { describe, expect, it } from "vitest";
import { isSurfaceTool, pickDevice } from "./surface-calls.js";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const ago = (ms: number): Date => new Date(NOW - ms);

const device = (
  id: string,
  seenMsAgo: number | null,
  focusedMsAgo: number | null = null,
): { id: string; orgId: string; deviceName: string; lastSeenAt: Date | null; focusedAt: Date | null } => ({
  id,
  orgId: "org-1",
  deviceName: `mac-${id}`,
  lastSeenAt: seenMsAgo === null ? null : ago(seenMsAgo),
  focusedAt: focusedMsAgo === null ? null : ago(focusedMsAgo),
});

describe("which tools go to the window", () => {
  it("claims the app tools only", () => {
    expect(isSurfaceTool("app-navigate")).toBe(true);
    expect(isSurfaceTool("app-screenshot")).toBe(true);
    expect(isSurfaceTool("page-read")).toBe(false);
    expect(isSurfaceTool("spaces-users")).toBe(false);
  });
});

describe("choosing which window to drive", () => {
  it("says offline when no device has been seen recently", () => {
    const picked = pickDevice([device("a", 10 * 60_000), device("b", null)], NOW);
    expect(picked.device).toBeNull();
    expect(picked.reason).toBe("offline");
  });

  it("uses the only live device without needing focus", () => {
    const picked = pickDevice([device("a", 5_000), device("b", 10 * 60_000)], NOW);
    expect(picked.device?.id).toBe("a");
    expect(picked.reason).toBe("only");
  });

  it("prefers the window the user is actually in front of", () => {
    const picked = pickDevice([device("a", 5_000), device("b", 5_000, 20_000)], NOW);
    expect(picked.device?.id).toBe("b");
    expect(picked.reason).toBe("focused");
  });

  it("takes the most recently focused when two are focused", () => {
    const picked = pickDevice([device("a", 5_000, 90_000), device("b", 5_000, 10_000)], NOW);
    expect(picked.device?.id).toBe("b");
  });

  it("refuses to guess between live devices with stale focus", () => {
    const picked = pickDevice([device("a", 5_000, 60 * 60_000), device("b", 5_000)], NOW);
    expect(picked.device).toBeNull();
    expect(picked.reason).toBe("ambiguous");
    expect(picked.online).toHaveLength(2);
  });

  it("ignores focus on a device that has gone offline", () => {
    const picked = pickDevice([device("a", 10 * 60_000, 1_000), device("b", 5_000)], NOW);
    expect(picked.device?.id).toBe("b");
  });
});
