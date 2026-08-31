/**
 * Skill-management custom tools — let an agent author and revise Claw skills
 * with human approval, reusing the existing HITL machinery rather than a new
 * approval system.
 *
 *   create-skill  → WRITE tool. The pod signs a pending action; claw-auth's
 *                   webhook renders an Approve/Decline card to the REQUESTER
 *                   (self-approval of a draft). On approve, flow-action's
 *                   `serverType==="skill"` branch persists the Skill row owned
 *                   by the approver. Nothing is written until approval.
 *
 *   update-skill  → NON-write tool that PROPOSES a change. It cannot self-apply
 *                   because the approver is the skill's OWNER, who may be a
 *                   different user. execute() posts to claw-auth's
 *                   /skills/:slug/propose-update, which computes the diff,
 *                   records a SkillChangeRequest, and DMs the owner a card
 *                   showing ONLY the diff. The owner's click drives the actual
 *                   update via flow-action's `actionType==="skill-update"`.
 *
 * Both tools deliberately keep persistence OUT of the pod: the pod never has
 * DB access, and centralizing the write in claw-auth keeps one source of truth
 * (and one place that enforces ownership + content-integrity checks).
 */

import type { ToolDefinition } from "../types.js";

// Env is read lazily inside execute() (not at module load) so the values are
// picked up from the pod environment at call time and are trivially stubbable
// in tests.
function authUrl(): string {
  return (process.env["XYNE_CLAW_AUTH_URL"] ?? "http://xyne-claw-auth.xyne-apps.svc.cluster.local:3003").replace(/\/$/, "");
}
function s2sKey(): string {
  return process.env["XYNE_CLAW_S2S_KEY"] ?? "";
}

/** Slugs must be lowercase kebab so they map cleanly to the DB unique key. */
function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const createSkillTool: ToolDefinition = {
  slug: "create-skill",
  name: "Create Skill",
  description:
    "Draft a NEW Claw skill (a reusable markdown instruction file) and submit it for approval. " +
    "The user sees an Approve/Decline card with the skill name and full markdown; NOTHING is saved until they approve. " +
    "On approval the skill is created as a PERSONAL skill owned by the approving user. " +
    "Provide: name (human title), slug (optional — auto-derived from name if omitted), description (one line shown in the skill picker), and content (the full SKILL.md markdown body). " +
    "Use this when the user asks you to 'create a skill', 'save this as a skill', or 'turn these instructions into a skill'.",
  // Grouped with the other authoring tools. NOTE: for a write tool the source
  // also determines the signed action's serverType (custom-tools.ts strips the
  // "custom:" prefix), so this moved create-skill from serverType "skill" to
  // "agent-tools". flow-action keeps the old "skill" branch alive for actions
  // signed before this shipped.
  source: "custom:agent-tools",
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable skill title, e.g. 'Jenkins Investigation'. Required." },
      slug: { type: "string", description: "Optional kebab-case slug, e.g. 'jenkins-investigation'. Auto-derived from name when omitted." },
      description: { type: "string", description: "One-line description shown in the skill picker. Required." },
      content: { type: "string", description: "The full SKILL.md markdown body. Required." },
    },
    required: ["name", "description", "content"],
  },
  // Write tools are intercepted in xyne-claw/custom-tools.ts BEFORE execute
  // runs (the pod signs a pending action instead). This body is a defensive
  // fallback and must never persist — the real create happens in claw-auth's
  // flow-action `serverType==="skill"` branch after approval.
  execute: async () =>
    "create-skill is an approval-gated write tool: the user will receive an Approve/Decline card. The skill is only created after they approve.",
};

export const updateSkillTool: ToolDefinition = {
  slug: "update-skill",
  name: "Update Skill",
  description:
    "Propose an update to an EXISTING Claw skill. You do not apply the change directly — the skill's owner receives a DM showing ONLY the diff (what you added/removed) and approves or declines it. " +
    "PREFERRED: provide `edits` — an array of {oldText, newText} anchored replacements. oldText must be copied EXACTLY from the current skill and must be unique within it; newText replaces it. " +
    "To insert a new section, use an edit whose oldText is the exact line/heading you want to insert after, and whose newText is that same line followed by your new section. " +
    "Edits scale with the CHANGE size, so they work on skills of any length. " +
    "SMALL SKILLS ONLY: `content` (full replacement) is a convenience for skills under ~8K chars, where a whole-body rewrite is cheaper than quoting old+new via edits. The server REJECTS full replacements of larger skills — a large body does not survive as a tool argument (it gets truncated and destroys the skill). " +
    "Always read the current skill first so your oldText anchors are exact. " +
    "Re-proposing is safe: a new proposal automatically replaces your earlier still-pending one for the same skill.",
  // Grouped with the other authoring tools. Safe to move: update-skill is not a
  // write tool, so its source is purely the catalog group — it posts to
  // claw-auth's /skills/:slug/propose-update itself.
  source: "custom:agent-tools",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Slug of the existing skill to update, e.g. 'jenkins-investigation'. Required." },
      edits: {
        type: "array",
        description: "PREFERRED. Anchored replacements applied in order to the CURRENT skill content. Each oldText must appear exactly once.",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string", description: "Exact snippet copied from the current skill (unique within it)." },
            newText: { type: "string", description: "Replacement text (empty string deletes the snippet)." },
          },
          required: ["oldText", "newText"],
        },
      },
      content: { type: "string", description: "Full replacement — small skills (<~8K chars) only; rejected for larger ones. Prefer `edits`." },
      summary: { type: "string", description: "Optional short note describing what changed and why — shown to the owner alongside the diff." },
    },
    required: ["slug"],
  },
  execute: async (params, context) => {
    const slug = normalizeSlug(String(params["slug"] ?? ""));
    const content = typeof params["content"] === "string" ? params["content"] : "";
    const rawEdits = Array.isArray(params["edits"]) ? (params["edits"] as unknown[]) : [];
    const edits = rawEdits
      .filter((e): e is { oldText: string; newText: string } =>
        !!e && typeof e === "object" &&
        typeof (e as Record<string, unknown>)["oldText"] === "string" &&
        typeof (e as Record<string, unknown>)["newText"] === "string" &&
        ((e as Record<string, unknown>)["oldText"] as string).length > 0)
      .map((e) => ({ oldText: e.oldText, newText: e.newText }));
    const summary = typeof params["summary"] === "string" ? params["summary"] : undefined;
    if (!slug) return JSON.stringify({ error: "slug is required" });
    if (edits.length === 0 && !content.trim()) {
      return JSON.stringify({ error: "Provide `edits` (preferred) or `content`. For anything but a small skill, use edits." });
    }

    const proposerUserId = context?.meta?.["userId"];
    const agentSlug = context?.meta?.["agentSlug"];
    if (!proposerUserId) {
      return JSON.stringify({ error: "Cannot propose skill update: missing requesting user id in tool context." });
    }
    const S2S_KEY = s2sKey();
    if (!S2S_KEY) {
      return JSON.stringify({ error: "XYNE_CLAW_S2S_KEY not set in claw-pod environment — update-skill cannot authenticate to claw-auth." });
    }

    const url = `${authUrl()}/claw/api/v1/skills/${encodeURIComponent(slug)}/propose-update`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-s2s-key": S2S_KEY,
          "x-user-id": proposerUserId,
        },
        body: JSON.stringify({ ...(edits.length > 0 ? { edits } : { content }), summary, agentSlug }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: `Failed to reach claw-auth at ${url}: ${msg}` });
    }

    const bodyText = await res.text();
    let json: { success?: boolean; error?: string; data?: unknown } = {};
    try { json = bodyText ? JSON.parse(bodyText) : {}; } catch { /* non-JSON */ }

    if (res.status === 404) {
      return JSON.stringify({ error: `Skill "${slug}" not found in your org. Check the slug.` });
    }
    if (res.status === 409) {
      return JSON.stringify({ error: json.error ?? "Your update is identical to the current skill — nothing to propose." });
    }
    if (!res.ok || json.success === false) {
      return JSON.stringify({ error: json.error ?? `propose-update failed (HTTP ${res.status})` });
    }
    return JSON.stringify({
      status: "proposed",
      message: "Update proposed. The skill owner has been sent a DM showing the diff and can approve or decline it.",
      data: json.data ?? null,
    });
  },
};
