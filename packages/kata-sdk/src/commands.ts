import type { Session } from "./session.js";
import type { ExecResult, JobStatus } from "./types.js";

interface ExecuteResponse {
  stdout?: unknown;
  stderr?: unknown;
  exit_code?: unknown;
}

interface DetachedResponse {
  jobId?: unknown;
}

interface JobResponse {
  done?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
}

export class CommandsModule {
  constructor(private readonly session: Session) {}

  async run(cmd: string, timeoutMs = 60_000): Promise<ExecResult> {
    if (cmd.trim().length === 0) {
      throw new Error("Command must be a non-empty string.");
    }

    const response = await this.session.requestJson<ExecuteResponse>("/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: cmd }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    return {
      stdout: typeof response.stdout === "string" ? response.stdout : "",
      stderr: typeof response.stderr === "string" ? response.stderr : "",
      exitCode: typeof response.exit_code === "number" ? response.exit_code : 1,
    };
  }

  async runDetached(cmd: string): Promise<string> {
    if (cmd.trim().length === 0) {
      throw new Error("Command must be a non-empty string.");
    }

    const response = await this.session.requestJson<DetachedResponse>("/execute/detached", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });

    if (typeof response.jobId !== "string") {
      throw new Error("Invalid response from detached execute: missing jobId.");
    }

    return response.jobId;
  }

  async pollJob(jobId: string): Promise<JobStatus> {
    const response = await this.session.requestJson<JobResponse>(`/jobs/${jobId}`, {
      method: "GET",
    });

    return {
      done: response.done === true,
      stdout: typeof response.stdout === "string" ? response.stdout : "",
      stderr: typeof response.stderr === "string" ? response.stderr : "",
      exitCode: typeof response.exitCode === "number" ? response.exitCode : null,
    };
  }
}
