import { createLogger } from "../logger.js";
import { notionRemoteEnsureServer } from "../routes/notion-remote-oauth.js";
import { linearEnsureServer } from "../routes/linear-oauth.js";
import { atlassianRemoteEnsureServer } from "../routes/atlassian-remote-oauth.js";
import { githubRemoteEnsureServer } from "../routes/github-remote-oauth.js";
import { slackRemoteEnsureServer } from "../routes/slack-remote-oauth.js";

const log = createLogger("oauth-connectors");

interface ConnectorRow {
  type: string;
  ensure: () => Promise<unknown>;
  requiredEnv: readonly string[];
}

const CONNECTORS: readonly ConnectorRow[] = [
  { type: "notion-remote", ensure: notionRemoteEnsureServer, requiredEnv: [] },
  { type: "linear", ensure: linearEnsureServer, requiredEnv: [] },
  { type: "atlassian-remote", ensure: atlassianRemoteEnsureServer, requiredEnv: [] },
  { type: "github-remote", ensure: githubRemoteEnsureServer, requiredEnv: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"] },
  { type: "slack-remote", ensure: slackRemoteEnsureServer, requiredEnv: ["SLACK_MCP_CLIENT_ID", "SLACK_MCP_CLIENT_SECRET"] },
];

/**
 * The OAuth factories create a connector's `mcp_servers` row on the first
 * successful connect, so the connector would not be listed (Library, onboarding)
 * until someone had connected it. Create the rows at boot instead. Connectors
 * that need a client id/secret are skipped until those env vars are set, so a
 * Connect button never leads to a misconfigured flow. Idempotent.
 */
export async function ensureOAuthConnectorServers(): Promise<void> {
  for (const connector of CONNECTORS) {
    const missing = connector.requiredEnv.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      log.info(`[oauth-connectors] ${connector.type} not listed: ${missing.join(", ")} not set`);
      continue;
    }
    try {
      await connector.ensure();
    } catch (err) {
      log.error(`[oauth-connectors] could not ensure ${connector.type}:`, err);
    }
  }
}
