/**
 * Jenkins tool definitions for xyne-claw.
 * All tools use source "custom:jenkins" and require JENKINS_* config.
 */

import type { ToolDefinition, ToolExecutionContext, ConfigField } from "../types.js";
import {
  triggerBuild,
  getLatestBuild,
  getBuildByNumber,
  getBuildStages,
  getBuildLogs,
  listBuilds,
  type ApiConfig,
} from "./api.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const JENKINS_CONFIG_SCHEMA: Record<string, ConfigField> = {
  JENKINS_BASE_URL: {
    label: "Jenkins Base URL",
    default: "https://jenkins.internal.example.com",
    required: true,
  },
  JENKINS_JOB_PATH: {
    label: "Jenkins Job Path",
    default: "/job/xyne/job/xyne-spaces",
    required: true,
  },
  JENKINS_USERNAME: { label: "Jenkins Username", default: "", required: true },
  JENKINS_API_TOKEN: { label: "Jenkins API Token", default: "", required: true },
};

function getConfig(ctx?: ToolExecutionContext): ApiConfig {
  const cfg = ctx?.config;
  if (!cfg) throw new Error("Jenkins tools require config");
  const username = cfg["JENKINS_USERNAME"];
  const apiToken = cfg["JENKINS_API_TOKEN"];
  if (!username || !apiToken) {
    throw new Error("Jenkins tools require JENKINS_USERNAME and JENKINS_API_TOKEN");
  }
  return {
    baseUrl: cfg["JENKINS_BASE_URL"] || "https://jenkins.internal.example.com",
    jobPath: cfg["JENKINS_JOB_PATH"] || "/job/xyne/job/xyne-spaces",
    username,
    apiToken,
  };
}

function formatBuild(build: { number: number; result: string | null; building: boolean; url: string; timestamp?: number }): string {
  const status = build.building ? "BUILDING" : build.result || "UNKNOWN";
  const time = build.timestamp ? new Date(build.timestamp).toISOString() : "N/A";
  return `#${build.number} | ${status} | ${time} | ${build.url}`;
}

function formatStage(stage: { name: string; status: string; durationMillis: number }): string {
  const durationSec = Math.round(stage.durationMillis / 1000);
  return `${stage.name}: ${stage.status} (${durationSec}s)`;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const jenkinsTriggerBuild: ToolDefinition = {
  slug: "jenkins-trigger-build",
  name: "Jenkins Trigger Build",
  description: "Trigger a Jenkins build for a specific branch. Optionally pass build parameters.",
  source: "custom:jenkins",
  isWriteTool: true,
  configSchema: JENKINS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      branch: { type: "string", description: "Branch name to build (e.g., 'main', 'feature/XYNE-1234')" },
      parameters: {
        type: "object",
        description: "Optional build parameters as key-value pairs",
        additionalProperties: { type: "string" },
      },
    },
    required: ["branch"],
  },
  async execute(args, ctx) {
    const config = getConfig(ctx);
    const branch = args["branch"] as string;
    const parameters = (args["parameters"] as Record<string, string> | undefined) ?? undefined;
    const result = await triggerBuild(config, branch, parameters);
    return result.success
      ? `✅ ${result.message || "Build triggered"} for branch: ${branch}`
      : `❌ Failed: ${result.error || "Unknown error"}`;
  },
};

export const jenkinsGetBuildStatus: ToolDefinition = {
  slug: "jenkins-get-build-status",
  name: "Jenkins Get Build Status",
  description:
    "Get build status and pipeline stages. Use without buildNumber to get latest build. " +
    "Returns result, stages, and duration.",
  source: "custom:jenkins",
  configSchema: JENKINS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      branch: { type: "string", description: "Branch name" },
      buildNumber: { type: "number", description: "Specific build number (omit for latest)" },
    },
    required: ["branch"],
  },
  async execute(args, ctx) {
    const config = getConfig(ctx);
    const branch = args["branch"] as string;
    const buildNumber = args["buildNumber"] as number | undefined;

    const build = buildNumber
      ? await getBuildByNumber(config, branch, buildNumber)
      : await getLatestBuild(config, branch);

    if (!build) return `No build found for branch: ${branch}${buildNumber ? ` #${buildNumber}` : ""}`;

    const stages = await getBuildStages(config, branch, build.number);
    const stageLines = stages.length > 0 ? stages.map(formatStage).join("\n") : "No stages available";

    return [
      `Build: ${formatBuild(build)}`,
      `Stages (${stages.length}):`,
      stageLines,
    ].join("\n");
  },
};

export const jenkinsListBuilds: ToolDefinition = {
  slug: "jenkins-list-builds",
  name: "Jenkins List Builds",
  description: "List recent builds for a branch. Shows build number, status, and timestamp.",
  source: "custom:jenkins",
  configSchema: JENKINS_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      branch: { type: "string", description: "Branch name" },
      limit: { type: "number", description: "Max builds to return (default 10)" },
    },
    required: ["branch"],
  },
  async execute(args, ctx) {
    const config = getConfig(ctx);
    const branch = args["branch"] as string;
    const limit = (args["limit"] as number) ?? 10;
    const builds = await listBuilds(config, branch, limit);
    if (builds.length === 0) return `No builds found for branch: ${branch}`;
    return builds.map(formatBuild).join("\n");
  },
};

export const jenkinsGetBuildLogs: ToolDefinition = {
  slug: "jenkins-get-build-logs",
  name: "Jenkins Get Build Logs",
  description:
    "Get console logs for a build. Use to investigate failures. " +
    "Returns last 500 lines if logs are very long. Specify stageName for stage-specific logs.",
  source: "custom:jenkins",
  configSchema: JENKINS_CONFIG_SCHEMA,
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
  async execute(args, ctx) {
    const config = getConfig(ctx);
    const branch = args["branch"] as string;
    const buildNumberArg = args["buildNumber"] as number | undefined;
    const stageName = args["stageName"] as string | undefined;
    const maxLines = (args["maxLines"] as number) ?? 500;

    const buildNumber =
      buildNumberArg ?? (await getLatestBuild(config, branch))?.number ?? 0;
    if (!buildNumber) return `No build found for branch: ${branch}`;

    const logs = await getBuildLogs(config, branch, buildNumber, stageName);
    if (!logs) return `No logs available for build #${buildNumber}`;

    const lines = logs.split("\n");
    const truncated = lines.length > maxLines;
    const output = truncated ? lines.slice(-maxLines).join("\n") : logs;

    const header = stageName
      ? `Logs for build #${buildNumber}, stage: ${stageName}`
      : `Logs for build #${buildNumber}`;

    return [
      header,
      truncated ? `(showing last ${maxLines} of ${lines.length} lines)` : "",
      "---",
      output,
    ]
      .filter(Boolean)
      .join("\n");
  },
};

export { JENKINS_CONFIG_SCHEMA };
