import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import type { StdioMcpAdapter } from "../types.js";

const SERVER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../servers/jenkins-server.ts",
);

/**
 * Jenkins CI connector. Replaces the former built-in `custom:jenkins` tool
 * (packages/xyne-claw-shared/src/tools/jenkins) whose credentials came from
 * process.env / agent-config and threw a raw error when unset — the failure
 * mode behind the "error on approve" incident.
 *
 * Now a first-class MCP connector, following the same in-repo stdio pattern as
 * xyne-dashboard: per-connection credentials are stored encrypted, decrypted
 * server-side, injected as env vars into a spawned in-repo server, and verified
 * at connect time by the `jenkins_check_connection` health check. No external
 * npm binary is spawned — the toolset lives in this repo.
 *
 * `jenkins_trigger_build` is the only write tool, so triggering a build always
 * requires user approval; reads (status/list/logs) run autonomously.
 */
export const jenkinsAdapter: StdioMcpAdapter = {
  transport: "stdio",
  type: "jenkins",
  healthCheck: { name: "jenkins_check_connection", params: {} },
  writeTools: ["jenkins_trigger_build"],
  credentialFields: [
    { name: "username", label: "Jenkins Username", type: "text", placeholder: "svc-jenkins" },
    { name: "token", label: "Jenkins API Token", type: "password", placeholder: "" },
    {
      name: "baseUrl",
      label: "Jenkins Base URL",
      type: "text",
      placeholder: "https://jenkins.internal.example.com",
    },
    {
      name: "jobPath",
      label: "Jenkins Job Path",
      type: "text",
      placeholder: "/job/xyne/job/xyne-spaces",
      optional: true,
    },
  ],
  buildCommand(credentials) {
    const baseUrl = String(credentials["baseUrl"] ?? "").replace(/\/+$/, "");
    return {
      cmd: "node",
      args: ["--import", "tsx/esm", SERVER_PATH],
      env: {
        JENKINS_BASE_URL: baseUrl,
        JENKINS_JOB_PATH: String(credentials["jobPath"] ?? ""),
        JENKINS_USERNAME: String(credentials["username"] ?? ""),
        JENKINS_API_TOKEN: String(credentials["token"] ?? ""),
      },
    };
  },
};
