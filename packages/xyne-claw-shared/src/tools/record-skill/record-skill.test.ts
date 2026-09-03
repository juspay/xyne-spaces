import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "../types.js";
import { analyzeSkillRecording } from "./tools.js";

function context(meta: Record<string, string> = {}): ToolExecutionContext {
  return {
    config: {},
    meta: {
      userId: "u1",
      conversationId: "c1",
      agentSlug: "a1",
      taskCommand: "/record-skill",
      ...meta,
    },
  };
}

describe("analyze-skill-recording", () => {
  it("is a non-write sandbox tool", () => {
    expect(analyzeSkillRecording.slug).toBe("analyze-skill-recording");
    expect(analyzeSkillRecording.source).toBe("custom:sandbox");
    expect(analyzeSkillRecording.isWriteTool).toBeFalsy();
  });

  it("cannot be invoked outside /record-skill", async () => {
    const result = await analyzeSkillRecording.execute({}, context({ taskCommand: "/explainer" }));
    expect(result).toContain("only during a /record-skill run");
  });

  it("fails clearly when no recording is attached", async () => {
    const result = await analyzeSkillRecording.execute({}, context());
    expect(result).toContain("No screen recording was attached");
  });

  it("requires an exact filename when multiple recordings are attached", async () => {
    const recordingFiles = JSON.stringify([
      { fileName: "one.mp4", mimeType: "video/mp4", relPath: ".context/recordings/one.mp4" },
      { fileName: "two.mp4", mimeType: "video/mp4", relPath: ".context/recordings/two.mp4" },
    ]);
    const result = await analyzeSkillRecording.execute({}, context({ recordingFiles }));
    expect(result).toContain("More than one recording is attached");
    expect(result).toContain("one.mp4");
    expect(result).toContain("two.mp4");
  });

  it("rejects a server metadata path that escapes the run workspace", async () => {
    const recordingFiles = JSON.stringify([
      { fileName: "evil.mp4", mimeType: "video/mp4", relPath: "../../etc/passwd" },
    ]);
    const result = await analyzeSkillRecording.execute(
      {},
      context({ recordingFiles, recordingWorkspaceDir: "/data/workspaces/session" }),
    );
    expect(result).toContain("outside the run workspace");
  });
});
