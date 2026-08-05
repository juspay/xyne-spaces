/**
 * Runtime resolution of the skill artifact (SKILL.md content + bundled files)
 * an agent should actually run.
 *
 * Point 3/4 model: a Skill row is the LIVE working copy; each cut is frozen
 * into a SkillVersion (content + filesSnapshot). An AgentSkill/SubagentSkill
 * junction row may pin a specific version via `pinnedVersionId`. When pinned,
 * the agent runs that frozen snapshot; when NOT pinned (legacy rows, or the
 * kill-switch below), it follows the live skill content — the pre-versioning
 * behavior. This makes the whole feature fail-safe: if pin data is missing or
 * disabled, agents keep running exactly what they ran before.
 *
 * Kill-switch: set SKILL_VERSION_PINS_ENABLED=false to force every agent back
 * to live content regardless of pins (instant rollback with no data change).
 */

export interface ResolvedSkillFile {
  relativePath: string;
  content: string;
  contentType?: string | null;
}

interface AgentSkillLike {
  pinnedVersion?: {
    content: string;
    filesSnapshot: unknown;
  } | null;
  skill: {
    content: string;
    files?: Array<{ relativePath: string; content: string; contentType?: string | null }> | null;
  };
}

export function skillPinsEnabled(): boolean {
  return process.env.SKILL_VERSION_PINS_ENABLED !== "false";
}

/**
 * Given an AgentSkill/SubagentSkill row (with `pinnedVersion` and `skill.files`
 * included), return the content + files the run should materialize. Falls back
 * to live content whenever a pin is absent or the kill-switch is off.
 */
export function resolveAgentSkillArtifact(as: AgentSkillLike): {
  content: string;
  files: ResolvedSkillFile[];
} {
  if (skillPinsEnabled() && as.pinnedVersion) {
    const snap = Array.isArray(as.pinnedVersion.filesSnapshot)
      ? (as.pinnedVersion.filesSnapshot as Array<{ relativePath?: string; content?: string; contentType?: string | null }>)
      : [];
    return {
      content: as.pinnedVersion.content,
      files: snap
        .filter((f) => typeof f?.relativePath === "string" && typeof f?.content === "string")
        .map((f) => ({
          relativePath: f.relativePath as string,
          content: f.content as string,
          contentType: f.contentType ?? undefined,
        })),
    };
  }
  return {
    content: as.skill.content,
    files: (as.skill.files ?? []).map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
      contentType: f.contentType ?? undefined,
    })),
  };
}
