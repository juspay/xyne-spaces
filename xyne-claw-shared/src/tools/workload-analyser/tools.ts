import path from "node:path";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

                                                                                     
function dataPath(): string {                                                         
   const p = process.env["XYNE_WORKLOAD_DATA_PATH"];                                   
   if (!p) throw new Error("XYNE_WORKLOAD_DATA_PATH environment variable is not set"); 
   return p;                                                                           
} 

function getUserId(ctx?: ToolExecutionContext): string {
  const userId = ctx?.meta?.["userId"];
  if (!userId) throw new Error("Workload tools require userId in execution context");
  return userId;
}

function userDir(ctx?: ToolExecutionContext): string {
  return path.join(dataPath(), getUserId(ctx));
}

function reportsDir(ctx?: ToolExecutionContext): string {
  return path.join(userDir(ctx), "reports");
}
function sshKeyPath(): string {                                                       
    return process.env["SSH_KEY_PATH"] || "/tmp/ssh-keys/id_rsa";                       
}     

function gitExec(cmd: string, ctx?: ToolExecutionContext): string {
  const sshKey = ctx?.config?.["SSH_KEY_PATH"] || sshKeyPath();
  try {
    return execSync(cmd, {
      cwd: userDir(ctx),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_SSH_COMMAND: `ssh -i ${sshKey} -o StrictHostKeyChecking=no`,
      },
    }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() ?? "";
    throw new Error(`Git command failed: ${cmd}\n${stderr || err.message}`);
  }
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  return `---\n${yamlStringify(fm).trim()}\n---\n${body}`;
}

// ─── Shared Config Schema ──────────────────────────────────────────────────
   
  const WORKLOAD_CONFIG_SCHEMA = {                                                      
    WORKLOAD_REMOTE_URL: {                                                              
      label: "Workload Data Remote Git URL",                                            
      default: "",                                                                      
      required: false as const,                                                         
      placeholder: "ssh://git@bitbucket.example.com/user/workload-data.git",            
    },                                                                                  
  };   

// ─── Git Tools ──────────────────────────────────────────────────────────────

export const workloadPull: ToolDefinition = {
  slug: "workload-pull",
  name: "Pull Workload Repo",
  description: "Pull latest changes in the workload data repo (with rebase). Always call before reading or writing.",
  source: "workload",
  configSchema: WORKLOAD_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    const result = gitExec("git pull --rebase", ctx);
    return result || "Already up to date.";
  },
};

export const workloadCommit: ToolDefinition = {
  slug: "workload-commit",
  name: "Commit Workload Changes",
  description: "Stage all changes and commit in the workload data repo.",
  source: "workload",
  configSchema: WORKLOAD_CONFIG_SCHEMA,
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message" },
    },
    required: ["message"],
  },
  async execute(args, ctx) {
    gitExec("git add -A", ctx);
    const result = gitExec(
      `git commit --author="Workload Agent <workload@xyne.app>" -m ${JSON.stringify(args["message"])}`,
      ctx,
    );
    return result;
  },
};

export const workloadPush: ToolDefinition = {
  slug: "workload-push",
  name: "Push Workload Repo",
  description: "Push the workload data repo to its remote.",
  source: "workload",
  configSchema: WORKLOAD_CONFIG_SCHEMA,
  isWriteTool: true,
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    const result = gitExec("git push", ctx);
    return result || "Pushed successfully.";
  },
};

// ─── Report Tools ──────────────────────────────────────────────────────────

export const workloadListReports: ToolDefinition = {
  slug: "workload-list-reports",
  name: "List Workload Reports",
  description: "List all workload reports, optionally filtered by project code or cadence.",
  source: "workload",
  inputSchema: {
    type: "object",
    properties: {
      projectCode: { type: "string", description: "Filter by project code (e.g., 'EUL', 'INF')" },
      cadence: { type: "string", enum: ["daily", "weekly"], description: "Filter by cadence type" },
    },
  },
  async execute(args, ctx) {
    const dir = reportsDir(ctx);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return "No reports directory found. Run workload-init-repo first.";
    }

    const results: { name: string; slug: string; cadence: string; date: string; projectCode?: string }[] = [];

    for (const entry of entries.sort().reverse()) {
      const projectMatch = entry.match(/^([A-Z]+)\/(\d{4}-\d{2}-\d{2})-(daily|weekly)$/);
      const legacyMatch = entry.match(/^(\d{4}-\d{2}-\d{2})-(daily|weekly)$/);

      if (projectMatch) {
        const [, projectCode, date, cadence] = projectMatch;
        if (args["projectCode"] && projectCode !== args["projectCode"]) continue;
        if (args["cadence"] && cadence !== args["cadence"]) continue;
        results.push({ name: `${projectCode} ${cadence} report for ${date}`, slug: entry, cadence: cadence!, date: date!, projectCode: projectCode! });
      } else if (legacyMatch && !args["projectCode"]) {
        const [, date, cadence] = legacyMatch;
        if (args["cadence"] && cadence !== args["cadence"]) continue;
        results.push({ name: `${cadence} report for ${date}`, slug: entry, cadence: cadence!, date: date! });
      }
    }

    if (results.length === 0) return "No reports found.";
    return results.map((r) => `- **${r.name}** (\`${r.slug}\`)`).join("\n");
  },
};

export const workloadReadReport: ToolDefinition = {
  slug: "workload-read-report",
  name: "Read Workload Report",
  description: "Read the full content of a workload report's index.qmd.",
  source: "workload",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Report slug (e.g. 'EUL/2026-04-07-daily')" },
    },
    required: ["slug"],
  },
  async execute(args, ctx) {
    const filePath = path.join(reportsDir(ctx), args["slug"] as string, "index.qmd");
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return `Report '${args["slug"]}' not found.`;
    }
  },
};

export const workloadWriteReport: ToolDefinition = {
  slug: "workload-write-report",
  name: "Write Workload Report",
  description: "Create or overwrite a workload report. Call after collecting data from Spaces.",
  source: "workload",
  isWriteTool: true,
  inputSchema: {
    type: "object",
    properties: {
      cadence: { type: "string", enum: ["daily", "weekly"], description: "Report cadence" },
      projectCode: { type: "string", description: "Project code for project-scoped reports" },
      projectName: { type: "string", description: "Project name for the report title" },
      content: { type: "string", description: "Full Markdown body of the report" },
      date: { type: "string", description: "Report date as YYYY-MM-DD (defaults to today)" },
    },
    required: ["cadence", "content"],
  },
  async execute(args, ctx) {
    const date = (args["date"] as string) ?? new Date().toISOString().split("T")[0]!;
    const slug = args["projectCode"]
      ? `${args["projectCode"]}/${date}-${args["cadence"]}`
      : `${date}-${args["cadence"]}`;

    const reportDir = path.join(reportsDir(ctx), slug);
    await mkdir(reportDir, { recursive: true });

    const titlePrefix = args["projectCode"]
      ? `${args["projectCode"]} ${args["cadence"]}`
      : (args["cadence"] as string).charAt(0).toUpperCase() + (args["cadence"] as string).slice(1);

    const title = args["projectName"]
      ? `${titlePrefix} Workload Report — ${args["projectName"]} (${date})`
      : `${titlePrefix} Workload Report — ${date}`;

    const fm: Record<string, unknown> = {
      title,
      date,
      cadence: args["cadence"],
      generated_at: new Date().toISOString(),
    };
    if (args["projectCode"]) fm["project_code"] = args["projectCode"];
    if (args["projectName"]) fm["project_name"] = args["projectName"];

    const fileContent = serializeFrontmatter(fm, "\n" + (args["content"] as string));
    await writeFile(path.join(reportDir, "index.qmd"), fileContent);

    return `Written report to \`reports/${slug}/index.qmd\``;
  },
};

export const workloadRenderReport: ToolDefinition = {
  slug: "workload-render-report",
  name: "Render Workload Report",
  description: "Render a workload report to HTML and open in browser.",
  source: "workload",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Report slug" },
    },
    required: ["slug"],
  },
  async execute(args, ctx) {
    const reportDir = path.join(reportsDir(ctx), args["slug"] as string);
    const qmdPath = path.join(reportDir, "index.qmd");
    try {
      await readFile(qmdPath, "utf-8");
    } catch {
      throw new Error(`Report '${args["slug"]}' not found`);
    }
    try {
      execSync("quarto render index.qmd --to html", {
        cwd: reportDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err: any) {
      throw new Error(`Quarto render failed: ${err.stderr ?? err.message}`);
    }
    const outputPath = path.join(reportDir, "index.html");
    const platform = process.platform;
    const openCmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    execSync(`${openCmd} "${outputPath}"`, { stdio: "ignore" });
    return `Rendered report '${args["slug"]}' and opened in browser.`;
  },
};

export const workloadInitRepo: ToolDefinition = {
  slug: "workload-init-repo",
  name: "Init Workload Repo",
  description: "Initialize the workload data directory. Run once before generating the first report.",
  source: "workload",
  configSchema: WORKLOAD_CONFIG_SCHEMA,
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    const dir = userDir(ctx);
    await mkdir(path.join(dir, "reports"), { recursive: true });
    const readme = `# Workload Reports\n\nGenerated by the Xyne Workload Agent.\n`;
    const readmePath = path.join(dir, "README.md");
    try {
      await readFile(readmePath, "utf-8");
    } catch {
      await writeFile(readmePath, readme);
    }
    return `Initialized workload data directory at ${dir}`;
  },
};

export const workloadComputeCapacity: ToolDefinition = {
  slug: "workload-compute-capacity",
  name: "Compute Capacity",
  description: "Compute weighted capacity (HIGH/MEDIUM/LOW) for each team member. Do NOT compute load yourself.",
  source: "workload",
  inputSchema: {
    type: "object",
    properties: {
      members: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Team member's name" },
            startedTickets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  xyneId: { type: "string", description: "Ticket xyneId" },
                  eta: { type: "string", description: "ETA as ISO 8601 string" },
                },
                required: ["xyneId"],
              },
              description: "STARTED tickets assigned to this person",
            },
            pausedCount: { type: "number", description: "Number of PAUSED tickets" },
          },
          required: ["name", "startedTickets", "pausedCount"],
        },
        description: "One entry per team member",
      },
    },
    required: ["members"],
  },
  async execute(args, ctx) {
    const now = Date.now();
    const fortyEightHours = 48 * 60 * 60 * 1000;
    const members = args["members"] as Array<{
      name: string;
      startedTickets: Array<{ xyneId: string; eta?: string }>;
      pausedCount: number;
    }>;

    const results = members.map((member) => {
      const etaRiskTickets = member.startedTickets.filter((t) => {
        if (!t.eta) return false;
        const etaMs = new Date(t.eta).getTime();
        if (isNaN(etaMs)) return false;
        return etaMs <= now + fortyEightHours;
      });

      const raw = member.startedTickets.length + 0.5 * member.pausedCount + 1.5 * etaRiskTickets.length;
      const weighted_load = Math.round(raw * 10) / 10;
      const capacity: "HIGH" | "MEDIUM" | "LOW" = weighted_load < 2 ? "HIGH" : weighted_load < 4 ? "MEDIUM" : "LOW";

      return { name: member.name, started: member.startedTickets.length, paused: member.pausedCount, eta_risk_tickets: etaRiskTickets.map((t) => t.xyneId), weighted_load, capacity };
    });

    const lines = results.map((r) => {
      const etaPart = r.eta_risk_tickets.length > 0 ? ` | ETA-risk: ${r.eta_risk_tickets.join(", ")}` : "";
      return `${r.name}: started=${r.started} paused=${r.paused} weighted_load=${r.weighted_load} → ${r.capacity}${etaPart}`;
    });

    return lines.join("\n");
  },
};
