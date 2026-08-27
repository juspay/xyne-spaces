/**
 * Turns an awakened run's writePolicy into concrete per-tool denials.
 *
 * Why this is enforced with tool permissions rather than by prompting:
 * `apps-send-message` acts as the bot identity and is UNGATED by design (see
 * mcp/adapters/xyne-spaces.ts) — it exists precisely so an agent can post
 * autonomously. For an unattended run that is the whole risk surface, and an
 * instruction in a system prompt is not a control. The permission map is
 * evaluated at the MCP call boundary in claw-auth, so a denied tool cannot be
 * reached however the model is persuaded to try.
 *
 * "deny" is used rather than "ask": an approval card raised by a heartbeat at
 * 3am has nobody to click it, so "ask" would be a silent hang rather than a
 * clear refusal.
 *
 * Policies:
 *   observe — no outbound writes at all. Reason, and record.
 *   reply   — may reply inside existing threads; may not start new ones or
 *             mutate tickets/canvases.
 *   act     — full write surface the agent normally has.
 * `shadow` overrides all three down to observe.
 */

import type { AwakeningConfig } from "./config.js";

const SPACES = "xyne-spaces";
const SPACES_APP = "xyne-spaces-app-tools";

/** Tool permission keys are `${serverType}__${toolName}` — see xyne-claw/src/mcp.ts. */
function key(serverType: string, tool: string): string {
  return `${serverType}__${tool}`;
}

/** Posts a message as the bot. The one genuinely autonomous write. */
const APP_MESSAGE_TOOLS = ["apps-send-message"];

/** Posts as the human user; HITL-gated in normal runs, impossible in an unattended one. */
const USER_MESSAGE_TOOLS = ["user-send-message"];

/** Creates or mutates durable objects — never allowed below "act". */
const MUTATION_TOOLS = [
  "spaces-create-ticket",
  "spaces-create-bulk-tickets",
  "spaces-update-ticket",
  "spaces-update-bulk-tickets",
  "spaces-schedule-call",
  "spaces-create-canvas",
  "spaces-edit-canvas",
  "spaces-upload-to-kb",
];

/**
 * The permission map for a run, merged over whatever the agent already has.
 * Existing per-tool settings are preserved unless this policy denies the tool —
 * a denial always wins.
 */
export function buildWritePermissions(
  config: AwakeningConfig,
  existing: Record<string, string> = {},
): Record<string, string> {
  const effective = config.shadow ? "observe" : config.writePolicy;
  const denied: string[] = [];

  if (effective === "observe") {
    denied.push(
      ...APP_MESSAGE_TOOLS.map((t) => key(SPACES_APP, t)),
      ...APP_MESSAGE_TOOLS.map((t) => key(SPACES, t)),
      ...USER_MESSAGE_TOOLS.map((t) => key(SPACES, t)),
      ...MUTATION_TOOLS.map((t) => key(SPACES, t)),
    );
  } else if (effective === "reply") {
    // Messaging stays available (that IS replying); durable mutations do not.
    denied.push(
      ...USER_MESSAGE_TOOLS.map((t) => key(SPACES, t)),
      ...MUTATION_TOOLS.map((t) => key(SPACES, t)),
    );
  }

  const permissions: Record<string, string> = { ...existing };
  for (const k of denied) permissions[k] = "deny";
  return permissions;
}

/** True when the run may not produce any outbound Spaces write. */
export function isReadOnlyRun(config: AwakeningConfig): boolean {
  return config.shadow || config.writePolicy === "observe";
}
