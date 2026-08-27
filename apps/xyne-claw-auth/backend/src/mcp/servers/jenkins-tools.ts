/**
 * Jenkins MCP tools — the toolset served by jenkins-server.ts.
 *
 * Ported from the former built-in xyne-claw tool
 * (packages/xyne-claw-shared/src/tools/jenkins/{api,tools}.ts). The REST client
 * logic (crumb/CSRF + Basic auth) is unchanged; what changed is HOW credentials
 * arrive: they are now supplied per-connection from the user's stored Jenkins
 * connection and injected as env vars by the adapter, instead of the old
 * process.env / agent-config resolution that threw a raw error and failed
 * silently when unset.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errMsg } from "../../lib/errors.js";

// ─── Config ───────────────────────────────────────────────────────────────

export interface JenkinsConfig {
  baseUrl: string;
  jobPath: string;
  username: string;
  apiToken: string;
}

interface JenkinsBuild {
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  timestamp: number;
}

interface JenkinsStage {
  name: string;
  status: string;
  durationMillis: number;
}

interface JenkinsBuildInfo {
  number: number;
  result: string | null;
  building: boolean;
  url: string;
  timestamp: number;
}

// ─── REST client (ported verbatim from the old api.ts) ──────────────────────

function getAuthHeader(username: string, apiToken: string): string {
  return "Basic " + Buffer.from(`${username}:${apiToken}`).toString("base64");
}

async function getCrumb(
  config: JenkinsConfig,
): Promise<{ crumb: string; crumbField: string } | null> {
  try {
    const response = await fetch(`${config.baseUrl}/crumbIssuer/api/json`, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { crumb: string; crumbRequestField: string };
    return { crumb: data.crumb, crumbField: data.crumbRequestField };
  } catch {
    return null;
  }
}

async function triggerBuild(
  config: JenkinsConfig,
  branch: string,
  parameters?: Record<string, string>,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const crumb = await getCrumb(config);
    let url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/buildWithParameters?delay=0`;
    if (parameters && Object.keys(parameters).length > 0) {
      url += "&" + new URLSearchParams(parameters).toString();
    }
    const headers: Record<string, string> = {
      Authorization: getAuthHeader(config.username, config.apiToken),
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (crumb) headers[crumb.crumbField] = crumb.crumb;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: "json={}",
      redirect: "manual",
    });
    if (response.status >= 200 && response.status < 400) {
      return { success: true, message: "Build triggered successfully" };
    }
    return { success: false, error: `Jenkins returned ${response.status}` };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

async function getLatestBuild(config: JenkinsConfig, branch: string): Promise<JenkinsBuild | null> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/lastBuild/api/json`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return null;
    return (await response.json()) as JenkinsBuild;
  } catch {
    return null;
  }
}

async function getBuildByNumber(
  config: JenkinsConfig,
  branch: string,
  buildNumber: number,
): Promise<JenkinsBuild | null> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/api/json`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return null;
    return (await response.json()) as JenkinsBuild;
  } catch {
    return null;
  }
}

async function getBuildStages(
  config: JenkinsConfig,
  branch: string,
  buildNumber: number,
): Promise<JenkinsStage[]> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/wfapi/describe`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { stages?: JenkinsStage[] };
    return data.stages || [];
  } catch {
    return [];
  }
}

async function getBuildLogs(
  config: JenkinsConfig,
  branch: string,
  buildNumber: number,
  stageName?: string,
): Promise<string> {
  try {
    const url = stageName
      ? `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/execution/node/${stageName}/wfapi/log`
      : `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/consoleText`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

async function listBuilds(
  config: JenkinsConfig,
  branch: string,
  limit: number = 10,
): Promise<JenkinsBuildInfo[]> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/api/json?tree=builds[id,number,result,building,url,timestamp]{0,${limit}}`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { builds?: JenkinsBuildInfo[] };
    return data.builds || [];
  } catch {
    return [];
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function formatBuild(build: {
  number: number;
  result: string | null;
  building: boolean;
  url: string;
  timestamp?: number;
}): string {
  const status = build.building ? "BUILDING" : build.result || "UNKNOWN";
  const time = build.timestamp ? new Date(build.timestamp).toISOString() : "N/A";
  return `#${build.number} | ${status} | ${time} | ${build.url}`;
}

function formatStage(stage: JenkinsStage): string {
  return `${stage.name}: ${stage.status} (${Math.round(stage.durationMillis / 1000)}s)`;
}

// ─── Tool contract ──────────────────────────────────────────────────────────

export interface ToolContext {
  config: JenkinsConfig;
}

export interface JenkinsTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<CallToolResult>;
}

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: body }], isError };
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const tools: JenkinsTool[] = [
  {
    name: "jenkins_check_connection",
    description:
      "Verify the configured Jenkins credentials and base URL work end-to-end. " +
      "Used as the connection health check; also callable to confirm connectivity.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler(_args, { config }) {
      try {
        const response = await fetch(`${config.baseUrl}/api/json`, {
          headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
        });
        if (response.ok) {
          return text(`Connected to Jenkins at ${config.baseUrl}`);
        }
        return text(
          `Jenkins returned ${response.status} for ${config.baseUrl}. Check the base URL, username and API token.`,
          true,
        );
      } catch (err) {
        return text(
          `Could not reach Jenkins at ${config.baseUrl}: ${errMsg(err)}`,
          true,
        );
      }
    },
  },
  {
    name: "jenkins_trigger_build",
    description:
      "Trigger a Jenkins build for a specific branch. Optionally pass build parameters.",
    inputSchema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch name to build (e.g., 'main', 'feature/XYNE-1234')",
        },
        parameters: {
          type: "object",
          description: "Optional build parameters as key-value pairs",
          additionalProperties: { type: "string" },
        },
      },
      required: ["branch"],
    },
    async handler(args, { config }) {
      const branch = String(args["branch"] ?? "");
      if (!branch) return text("Missing required argument: branch", true);
      const parameters = (args["parameters"] as Record<string, string> | undefined) ?? undefined;
      const result = await triggerBuild(config, branch, parameters);
      return result.success
        ? text(`✅ ${result.message || "Build triggered"} for branch: ${branch}`)
        : text(`❌ Failed: ${result.error || "Unknown error"}`, true);
    },
  },
  {
    name: "jenkins_get_build_status",
    description:
      "Get build status and pipeline stages. Use without buildNumber to get the latest build. " +
      "Returns result, stages, and duration.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch name" },
        buildNumber: { type: "number", description: "Specific build number (omit for latest)" },
      },
      required: ["branch"],
    },
    async handler(args, { config }) {
      const branch = String(args["branch"] ?? "");
      if (!branch) return text("Missing required argument: branch", true);
      const buildNumber = args["buildNumber"] as number | undefined;

      const build = buildNumber
        ? await getBuildByNumber(config, branch, buildNumber)
        : await getLatestBuild(config, branch);
      if (!build) {
        return text(`No build found for branch: ${branch}${buildNumber ? ` #${buildNumber}` : ""}`);
      }

      const stages = await getBuildStages(config, branch, build.number);
      const stageLines = stages.length > 0 ? stages.map(formatStage).join("\n") : "No stages available";
      return text([`Build: ${formatBuild(build)}`, `Stages (${stages.length}):`, stageLines].join("\n"));
    },
  },
  {
    name: "jenkins_list_builds",
    description: "List recent builds for a branch. Shows build number, status, and timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch name" },
        limit: { type: "number", description: "Max builds to return (default 10)" },
      },
      required: ["branch"],
    },
    async handler(args, { config }) {
      const branch = String(args["branch"] ?? "");
      if (!branch) return text("Missing required argument: branch", true);
      const limit = (args["limit"] as number) ?? 10;
      const builds = await listBuilds(config, branch, limit);
      if (builds.length === 0) return text(`No builds found for branch: ${branch}`);
      return text(builds.map(formatBuild).join("\n"));
    },
  },
  {
    name: "jenkins_get_build_logs",
    description:
      "Get console logs for a build. Use to investigate failures. " +
      "Returns the last 500 lines if logs are very long. Specify stageName for stage-specific logs.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch name" },
        buildNumber: { type: "number", description: "Build number (omit for latest)" },
        stageName: { type: "string", description: "Optional stage name for stage-specific logs" },
        maxLines: { type: "number", description: "Max lines to return (default 500)" },
      },
      required: ["branch"],
    },
    async handler(args, { config }) {
      const branch = String(args["branch"] ?? "");
      if (!branch) return text("Missing required argument: branch", true);
      const buildNumberArg = args["buildNumber"] as number | undefined;
      const stageName = args["stageName"] as string | undefined;
      const maxLines = (args["maxLines"] as number) ?? 500;

      const buildNumber = buildNumberArg ?? (await getLatestBuild(config, branch))?.number ?? 0;
      if (!buildNumber) return text(`No build found for branch: ${branch}`);

      const logs = await getBuildLogs(config, branch, buildNumber, stageName);
      if (!logs) return text(`No logs available for build #${buildNumber}`);

      const lines = logs.split("\n");
      const truncated = lines.length > maxLines;
      const output = truncated ? lines.slice(-maxLines).join("\n") : logs;
      const header = stageName
        ? `Logs for build #${buildNumber}, stage: ${stageName}`
        : `Logs for build #${buildNumber}`;
      return text(
        [header, truncated ? `(showing last ${maxLines} of ${lines.length} lines)` : "", "---", output]
          .filter(Boolean)
          .join("\n"),
      );
    },
  },
];
