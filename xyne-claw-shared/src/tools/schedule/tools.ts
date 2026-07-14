import type { ToolDefinition } from "../types.js";

export const SCHEDULE_CONFIG_SCHEMA = {
  XYNE_CLAW_AUTH_URL: {
    label: "Claw Auth Service URL",
    default: "http://localhost:3003",
    required: true as const,
    placeholder: "http://localhost:3003",
  },
  XYNE_CLAW_S2S_KEY: {
    label: "Claw S2S Key (for /scheduled-jobs auth)",
    default: "",
    required: false as const,
    placeholder: "Shared secret between xyne-claw and xyne-claw-auth",
  },
};

export const scheduleTask: ToolDefinition = {
  slug: "schedule-task",
  name: "Schedule Task",
  description:
    "Schedule the agent to run a task in the future. " +
    "Use type='once' with delayMs for a one-shot delayed execution (e.g. 86400000 = 24 hours). " +
    "Use type='cron' with cronExpression for recurring execution. " +
    "IMPORTANT: cronExpression is interpreted in **Asia/Kolkata (IST)** — write the time the " +
    "user actually said. \"daily at 12 AM\" → '0 0 * * *'. \"weekdays at 9 AM\" → '0 9 * * 1-5'. " +
    "Do NOT convert to UTC; the backend pins the scheduler to IST. " +
    "\n\nBy default the scheduled run's result is posted back as a reply in the originating " +
    "thread — same as how the agent already responds in the current conversation. " +
    'ONLY set `replyMode = "channel"` when the user EXPLICITLY asks for the output to be ' +
    'posted as a top-level channel message (e.g. "post the result to the channel", "send it ' +
    'to #engineering", "don\'t reply in the thread, just post it"). Do not ask the user ' +
    "where to post — defaulting to thread is correct for the common case.",
  source: "custom:schedule",
  configSchema: SCHEDULE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task description for the future agent run",
      },
      type: {
        type: "string",
        enum: ["once", "cron"],
        description: "'once' for one-shot, 'cron' for recurring",
      },
      delayMs: {
        type: "number",
        description:
          "For type='once': delay in milliseconds (e.g. 86400000 for 24h, 3600000 for 1h)",
      },
      cronExpression: {
        type: "string",
        description:
          "For type='cron': standard 5-field cron expression (e.g. '0 9 * * 1-5')",
      },
      label: {
        type: "string",
        description: "Human-friendly name for this scheduled task",
      },
      maxRuns: {
        type: "number",
        description:
          "For type='cron': maximum number of runs before auto-completing. Omit for unlimited.",
      },
      replyMode: {
        type: "string",
        enum: ["thread", "channel"],
        description:
          "Optional. Defaults to 'thread' (reply in the originating conversation). Set to 'channel' ONLY when the user explicitly asked for a top-level channel post — do not infer or ask.",
      },
    },
    required: ["task", "type"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const meta = context.meta ?? {};
    const userId = meta["userId"];
    const agentSlug = meta["agentSlug"];

    if (!userId)
      return "Error: Cannot schedule — no user identity available in execution context.";
    if (!agentSlug)
      return "Error: Cannot schedule — no agent slug available in execution context.";

    const authUrl =
      context.config["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003";
    const s2sKey = context.config["XYNE_CLAW_S2S_KEY"] ?? "";
    const type = params["type"] as string;

    const body: Record<string, unknown> = {
      userId,
      agentSlug,
      task: params["task"],
      type,
      channelId: meta["channelId"],
      conversationId: meta["conversationId"],
      label: params["label"],
      replyMode: params["replyMode"] ?? "thread",
    };

    if (type === "once") {
      body["delayMs"] = params["delayMs"];
      body["maxRuns"] = 1;
    } else {
      body["cronExpression"] = params["cronExpression"];
      if (params["maxRuns"] != null) body["maxRuns"] = params["maxRuns"];
    }

    try {
      // claw-auth's /scheduled-jobs is gated by requireAuth — for an S2S call
      // from xyne-claw the key is the only viable credential (we don't have
      // a user JWT in this context). Without it, requireAuth rejects with 401
      // and the tool returns "Authentication required" to the agent.
      const res = await fetch(`${authUrl}/claw/api/v1/scheduled-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await res.json()) as {
        success: boolean;
        data?: { id: string; nextRunAt?: string; cronExpression?: string };
        error?: string;
      };

      if (!data.success)
        return `Error scheduling task: ${data.error ?? "unknown error"}`;

      const job = data.data!;
      const label = (params["label"] as string) ?? (params["task"] as string);

      if (type === "once" && job.nextRunAt) {
        return `Scheduled "${label}" to run at ${new Date(job.nextRunAt).toLocaleString()} (job ID: ${job.id})`;
      }
      return `Scheduled recurring "${label}" with cron "${params["cronExpression"]}" (job ID: ${job.id})`;
    } catch (err) {
      return `Error scheduling task: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const scheduledJobControl: ToolDefinition = {
  slug: "scheduled-job-control",
  name: "Control Scheduled Job",
  description:
    "Pause, resume, cancel, or update an existing scheduled agent job. " +
    "When this tool is called from a scheduled-job run, use jobId='current' to control the schedule that triggered this turn. " +
    "Use action='pause' to temporarily stop future runs, action='resume' to restart a paused job, action='cancel' to permanently stop future runs, and action='update' to rewrite the task/prompt (pass 'task') and/or the label (pass 'label') the job runs on each fire. " +
    "Only control jobs owned by the current user/agent; do not use guessed job IDs.",
  source: "custom:schedule",
  configSchema: SCHEDULE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["pause", "resume", "cancel", "update"],
        description:
          "The control action to apply. Use 'update' to rewrite the task/prompt (and optionally the label) the job runs on each fire.",
      },
      jobId: {
        type: "string",
        description:
          "Scheduled job id, or 'current' when running inside that scheduled job",
      },
      reason: {
        type: "string",
        description: "Optional human-readable reason for audit/logging",
      },
      task: {
        type: "string",
        description:
          "For action='update': the new task/prompt the agent should run on each fire. Takes effect on the next run.",
      },
      label: {
        type: "string",
        description:
          "For action='update': optional new human-friendly label for the job.",
      },
    },
    required: ["action", "jobId"],
  },
  async execute(params, context) {
    if (!context) return "Error: No execution context available.";
    const meta = context.meta ?? {};
    const userId = meta["userId"];
    const agentSlug = meta["agentSlug"];

    if (!userId)
      return "Error: Cannot control scheduled job — no user identity available in execution context.";
    if (!agentSlug)
      return "Error: Cannot control scheduled job — no agent slug available in execution context.";

    const action = params["action"] as string;
    if (!["pause", "resume", "cancel", "update"].includes(action)) {
      return "Error: action must be one of pause, resume, cancel, or update.";
    }
    if (action === "update" && params["task"] == null && params["label"] == null) {
      return "Error: action='update' requires 'task' and/or 'label'.";
    }

    const requestedJobId = String(params["jobId"] ?? "").trim();
    const currentScheduledJobId = meta["scheduledJobId"];
    const jobId =
      requestedJobId === "current" ? currentScheduledJobId : requestedJobId;
    if (!jobId) {
      return requestedJobId === "current"
        ? "Error: This run is not associated with a scheduled job, so jobId='current' cannot be resolved."
        : "Error: jobId is required.";
    }

    const authUrl =
      context.config["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003";
    const s2sKey = context.config["XYNE_CLAW_S2S_KEY"] ?? "";

    try {
      const res = await fetch(
        `${authUrl}/claw/api/v1/scheduled-jobs/${encodeURIComponent(jobId)}/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(s2sKey ? { "x-s2s-key": s2sKey } : {}),
          },
          body: JSON.stringify({
            userId,
            agentSlug,
            reason: params["reason"],
            currentScheduledJobId,
            ...(action === "update"
              ? {
                  ...(params["task"] != null ? { task: params["task"] } : {}),
                  ...(params["label"] != null ? { label: params["label"] } : {}),
                }
              : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        data?: { id?: string; status?: string };
        error?: string;
      } | null;

      if (!res.ok || !data?.success) {
        return `Error: Failed to ${action} scheduled job ${jobId}: ${data?.error ?? res.statusText}`;
      }

      if (action === "update") {
        return `Updated scheduled job ${jobId}${params["task"] != null ? " (new task/prompt)" : ""}${params["label"] != null ? " (new label)" : ""}.`;
      }
      const status =
        data.data?.status ??
        (action === "resume"
          ? "active"
          : action === "pause"
            ? "paused"
            : "cancelled");
      return `Scheduled job ${jobId} is now ${status}.`;
    } catch (err) {
      return `Error: Failed to ${action} scheduled job: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
