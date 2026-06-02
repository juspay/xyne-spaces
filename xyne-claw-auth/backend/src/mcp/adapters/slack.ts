import type { StdioMcpAdapter } from "../types.js";

export const slackAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "slack",
  healthCheck: { name: "slack_list_channels", params: {} },
  writeTools: ["slack_post_message", "slack_reply_to_thread", "slack_add_reaction"],
  credentialFields: [
    { name: "botToken", label: "Slack Bot Token", type: "password", placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx" },
    { name: "teamId", label: "Slack Team ID", type: "text", placeholder: "T01234567" },
  ],
  buildCommand(credentials) {
    const botToken = credentials["botToken"] as string;
    const teamId = credentials["teamId"] as string;

    return {
      cmd: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: {
        SLACK_BOT_TOKEN: botToken,
        SLACK_TEAM_ID: teamId,
      },
    };
  },
};