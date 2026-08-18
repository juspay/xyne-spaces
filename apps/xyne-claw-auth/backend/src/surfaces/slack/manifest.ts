/**
 * The per-agent Slack app manifest template and the public URLs baked into it.
 * ONE source of truth: scope drift between deployed code and app config causes
 * admin-approval loops (2026-07-22), so the deployed template is authoritative
 * and sync-app pushes it to existing apps.
 */
import { createHash } from "node:crypto";
import { CONFIG } from "../../config.js";

export const SLACK_SCOPES = [
  "app_mentions:read",
  // The Slack MCP subagent lists and reads channels where the installed bot
  // is present. Slack separates public-channel and private-channel scopes.
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "chat:write",
  "chat:write.customize",
  "im:history",
  "im:read",
  "im:write",
  // Result attachments (test reports, HTML evidence) upload via the external
  // upload flow. Existing installs need a reinstall to gain this scope.
  "files:write",
  // Future apps can replace the working-message acknowledgement with an eyes
  // reaction. Existing installs do not gain this scope until reinstalled.
  "reactions:write",
  "users:read",
  "users:read.email",
] as const;

export function slackCallbackUri(): string {
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/oauth/callback`;
}

export function slackCommandsUri(): string {
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/commands`;
}

/** The org's umbrella app: the workspace-installed org-level Slack app row
 *  (legacy Connect-Slack OAuth path) whose manifest carries the slash
 *  commands. Returns the ACTIVE team row with an appId in config. */

export function slackManifest(agent: { name: string; slug: string }): Record<string, unknown> {
  return {
    display_information: { name: agent.name },
    features: {
      bot_user: { display_name: agent.slug, always_online: true },
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    oauth_config: {
      redirect_urls: [slackCallbackUri()],
      scopes: { bot: [...SLACK_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/slack/events`,
        bot_events: ["app_mention", "message.im"],
      },
      interactivity: { is_enabled: false },
      socket_mode_enabled: false,
    },
  };
}

/** Canonical JSON + sha256 of an agent's manifest — the staleness fingerprint
 *  compared against SurfaceAgent.config.manifestHash by /agents/status. */
export function serializedSlackManifest(agent: { name: string; slug: string }): {
  manifest: ReturnType<typeof slackManifest>;
  json: string;
  hash: string;
} {
  const manifest = slackManifest(agent);
  const json = JSON.stringify(manifest);
  return { manifest, json, hash: createHash("sha256").update(json).digest("hex") };
}
