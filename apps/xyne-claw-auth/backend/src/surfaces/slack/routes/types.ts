/** Route-level types for the Slack surface's HTTP boundary. */

/** Query param stamped on the post-OAuth redirect back to the org page;
 *  SurfacesCard reads it to toast success/failure. */
export type SlackConnectOutcomeParam = "slack_connected" | "slack_error";

/** One row of GET /agents/status — a per-agent Slack registration as the org
 *  admin UI sees it. `status` widens left-to-right: a command-only binding on
 *  the umbrella app, a minted app not yet consented to, then installed. */
export interface SlackAgentStatusEntry {
  agentId: string;
  agentSlug: string;
  appId: string;
  status: "command" | "created" | "installed";
  commandName?: string;
  installs: Array<{ teamId: string; teamName: string; installedAt: string }>;
  installUrl: string | null;
  manifestStale: boolean;
}

