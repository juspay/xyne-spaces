import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentSkillArtifact, skillPinsEnabled } from "./skillArtifact.js";

/**
 * Pure runtime pin-resolution logic (Point 3/4). No DB — the resolver only
 * transforms an already-loaded AgentSkill/SubagentSkill row into the content +
 * files a run should materialize. These cases lock in the fail-safe fallback:
 * a missing pin or the kill-switch must always yield the LIVE skill content, so
 * the feature can never make an agent run nothing.
 */
describe("resolveAgentSkillArtifact", () => {
  afterEach(() => {
    delete process.env.SKILL_VERSION_PINS_ENABLED;
  });

  it("falls back to live content + files when the agent is not pinned", () => {
    const r = resolveAgentSkillArtifact({
      skill: { content: "LIVE", files: [{ relativePath: "a.txt", content: "X", contentType: "text/plain" }] },
    });
    expect(r.content).toBe("LIVE");
    expect(r.files).toEqual([{ relativePath: "a.txt", content: "X", contentType: "text/plain" }]);
  });

  it("returns the pinned version's frozen content + files snapshot when pinned", () => {
    const r = resolveAgentSkillArtifact({
      pinnedVersion: {
        content: "PINNED",
        filesSnapshot: [{ relativePath: "b.txt", content: "Y", contentType: "text/plain" }],
      },
      skill: { content: "LIVE", files: [{ relativePath: "a.txt", content: "X" }] },
    });
    expect(r.content).toBe("PINNED");
    expect(r.files).toEqual([{ relativePath: "b.txt", content: "Y", contentType: "text/plain" }]);
  });

  it("ignores the pin and serves live content when the kill-switch is off", () => {
    process.env.SKILL_VERSION_PINS_ENABLED = "false";
    expect(skillPinsEnabled()).toBe(false);
    const r = resolveAgentSkillArtifact({
      pinnedVersion: { content: "PINNED", filesSnapshot: [{ relativePath: "b.txt", content: "Y" }] },
      skill: { content: "LIVE", files: [] },
    });
    expect(r.content).toBe("LIVE");
    expect(r.files).toEqual([]);
  });

  it("drops malformed entries from a pinned files snapshot", () => {
    const r = resolveAgentSkillArtifact({
      pinnedVersion: {
        content: "P",
        filesSnapshot: [
          { relativePath: "ok", content: "1" },
          { content: "no path" },
          "junk",
          null,
        ] as unknown as Array<{ relativePath: string; content: string }>,
      },
      skill: { content: "L", files: [] },
    });
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.relativePath).toBe("ok");
  });

  it("treats a non-array filesSnapshot as empty (defensive)", () => {
    const r = resolveAgentSkillArtifact({
      pinnedVersion: { content: "P", filesSnapshot: null },
      skill: { content: "L", files: [{ relativePath: "a", content: "1" }] },
    });
    expect(r.content).toBe("P");
    expect(r.files).toEqual([]);
  });
});
