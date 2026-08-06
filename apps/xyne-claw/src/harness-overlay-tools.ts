/**
 * Continual-harness session overlay tools (Phase 1: skills).
 *
 * Gives the running agent the ability to AUTHOR and REVISE its own skills
 * *live, mid-session* — prime-agent's "Continual Harness" idea, minus the
 * automatic global persistence that makes it unsafe.
 *
 * Trust model (deliberate):
 *   - Writes land ONLY in the session-scoped overlay dir
 *     (`<dataDir>/session-skills/<sessionId>/<slug>/SKILL.md`) — the exact
 *     directory pi's DefaultResourceLoader already scans for this run. After a
 *     write we call `resourceLoader.reload()` so the new/updated skill is
 *     advertised in `<available_skills>` on the next turn. The authored content
 *     is also in the model's context immediately (it just wrote it), so the
 *     skill is usable the rest of THIS run regardless of prompt-cache timing.
 *   - The overlay is EPHEMERAL and per-session: `deleteSessionSkills` removes it
 *     at session end. A wrong or reward-hacked self-edit therefore evaporates
 *     when the run ends — it can never reach another session or another user.
 *   - There is NO path from these tools to the durable, global `Skill` store.
 *     Promoting an overlay skill to future sessions is a SEPARATE,
 *     owner-approval-gated flow (follow-up PR). This module intentionally does
 *     not write to claw-auth.
 *
 * Enabled per-agent via `agentConfig.continualHarness === true` (resolved in
 * routes/run.ts, threaded through runTask as `enableHarnessOverlay`).
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { writeSessionSkills, deleteSessionSkills, sessionSkillsDir } from "./session-skills.js";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createLogger } from "./logger.js";
const log = createLogger("harness-overlay-tools");

/** Hard cap on authored skill body size — matches the spirit of the
 *  memory-file write cap; keeps a runaway loop from filling the overlay. */
const MAX_SKILL_CHARS = 20_000;
/** Bound the number of distinct skills one session may author, so a looping
 *  agent can't spawn unbounded skill dirs. */
const MAX_OVERLAY_SKILLS = 32;

/** Minimal resource-loader surface this module needs — just `reload()`. Keeps
 *  the dependency narrow and testable without importing pi's concrete type. */
export interface ReloadableResourceLoader {
  reload(): Promise<void>;
}

export interface HarnessOverlayDeps {
  /** THIS run's session id — the overlay scope. Required; without it there is
   *  no per-session isolation and the tools must not be built. */
  sessionId: string;
  resourceLoader: ReloadableResourceLoader;
}

/** Normalize a caller-supplied slug into pi's `[a-z0-9-]` shape. Returns null
 *  when nothing usable remains (all-symbol input). */
function normalizeSlug(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : null;
}

function ok(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export function buildHarnessOverlayTools(deps: HarnessOverlayDeps): ToolDefinition[] {
  const { sessionId, resourceLoader } = deps;
  // Track slugs authored this session — bounds growth and gives a future
  // session-end proposal bridge a clean list of what to consider promoting.
  const authored = new Set<string>();

  async function upsert(
    verb: "created" | "updated",
    rawSlug: string,
    name: string,
    description: string,
    content: string,
  ) {
    const slug = normalizeSlug(rawSlug || name);
    if (!slug) {
      return ok("Error: could not derive a valid skill slug (use letters/numbers).", { error: true });
    }
    if (!content.trim()) {
      return ok("Error: skill content is required.", { error: true });
    }
    if (verb === "created" && !authored.has(slug) && authored.size >= MAX_OVERLAY_SKILLS) {
      return ok(
        `Error: this session has already authored ${MAX_OVERLAY_SKILLS} overlay skills (the cap). Update an existing one instead.`,
        { error: true },
      );
    }
    try {
      const dir = await writeSessionSkills(sessionId, [
        {
          slug,
          name: name.trim() || slug,
          description: description.trim(),
          content: content.slice(0, MAX_SKILL_CHARS),
        },
      ]);
      if (!dir) {
        return ok("Error: overlay write produced no directory (empty session scope?).", { error: true });
      }
      // Re-scan so pi advertises the new/updated skill in <available_skills>.
      await resourceLoader.reload();
      authored.add(slug);
      log.info(`[overlay] ${verb} session skill '${slug}' (session=${sessionId}, ${authored.size} total)`);
      return ok(
        `Skill '${slug}' ${verb} for this session and is now active. It is available for the rest of this session only; it will NOT carry to future sessions unless you propose it and the agent owner approves.`,
        { slug, verb },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[overlay] ${verb} failed slug=${rawSlug} session=${sessionId}: ${msg}`);
      return ok(`Overlay skill ${verb === "created" ? "create" : "update"} failed: ${msg}`, { error: true });
    }
  }

  const createTool: ToolDefinition = {
    name: "overlay-create-skill",
    label: "Author Session Skill",
    description: [
      "Author a NEW skill live, for use during THIS session only.",
      "Use when you work out a reusable procedure mid-task (a checklist, a query recipe, a gotcha) that would help you later in this same run.",
      "The skill becomes available immediately and for the rest of this session. It is EPHEMERAL: it is discarded when the session ends and does NOT affect future sessions or other users.",
      "To make a good skill durable across future sessions, it must be proposed to the agent owner for approval (separate flow) — these tools never persist globally on their own.",
      `Body is capped at ${MAX_SKILL_CHARS} chars; write concise, concrete markdown.`,
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Human-readable skill name (e.g. 'Grafana Log Query Recipe')." },
        description: { type: "string", description: "One line describing when to use this skill (drives triggering)." },
        content: { type: "string", description: "The skill body in markdown — the actual procedure/knowledge." },
        slug: { type: "string", description: "Optional explicit slug ([a-z0-9-]); derived from name when omitted." },
      },
      required: ["name", "content"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const name = typeof p["name"] === "string" ? p["name"] : "";
      const description = typeof p["description"] === "string" ? p["description"] : "";
      const content = typeof p["content"] === "string" ? p["content"] : "";
      const slug = typeof p["slug"] === "string" ? p["slug"] : "";
      return upsert("created", slug || name, name, description, content);
    },
  };

  const updateTool: ToolDefinition = {
    name: "overlay-update-skill",
    label: "Revise Session Skill",
    description: [
      "Revise a skill you authored earlier in THIS session (by slug). Overwrites its content.",
      "Use to refine a session skill as you learn more during the run. Still ephemeral and session-scoped.",
      "Passing an unknown slug simply creates it. To change name/description, pass them too.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        slug: { type: "string", description: "Slug of the session skill to revise (as returned when you created it)." },
        content: { type: "string", description: "The new full markdown body (replaces the old one)." },
        name: { type: "string", description: "Optional new name." },
        description: { type: "string", description: "Optional new one-line description." },
      },
      required: ["slug", "content"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const slug = typeof p["slug"] === "string" ? p["slug"] : "";
      const content = typeof p["content"] === "string" ? p["content"] : "";
      const name = typeof p["name"] === "string" ? p["name"] : slug;
      const description = typeof p["description"] === "string" ? p["description"] : "";
      return upsert("updated", slug, name, description, content);
    },
  };

  const deleteTool: ToolDefinition = {
    name: "overlay-delete-skill",
    label: "Remove Session Skill",
    description: [
      "Remove a session skill you authored earlier in THIS session (by slug).",
      "Use to retract a session skill that turned out wrong. Only affects this session's overlay.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        slug: { type: "string", description: "Slug of the session skill to remove." },
      },
      required: ["slug"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const slug = normalizeSlug(typeof p["slug"] === "string" ? p["slug"] : "");
      if (!slug) return ok("Error: a valid slug is required.", { error: true });
      try {
        // Confine the delete to this session's overlay dir; never escape it.
        // slug is already normalized to [a-z0-9-] (no traversal possible);
        // the startsWith guard is a defensive backstop.
        const base = resolve(sessionSkillsDir(sessionId));
        const target = resolve(join(base, slug));
        if (!target.startsWith(base + "/") && target !== base) {
          return ok("Error: refusing to delete outside the session overlay.", { error: true });
        }
        await rm(target, { recursive: true, force: true }).catch(() => {});
        await resourceLoader.reload();
        authored.delete(slug);
        log.info(`[overlay] deleted session skill '${slug}' (session=${sessionId})`);
        return ok(`Skill '${slug}' removed from this session.`, { slug });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return ok(`Overlay skill delete failed: ${msg}`, { error: true });
      }
    },
  };

  // `deleteSessionSkills` is already invoked at session teardown by the run
  // lifecycle; referenced here only to document that the overlay is ephemeral.
  void deleteSessionSkills;

  return [createTool, updateTool, deleteTool];
}
