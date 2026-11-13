/**
 * `run_code` — a built-in agent tool for executing code in a sandbox.
 *
 * Generic over the backend: it drives `ctx.sandbox` (a {@link SandboxSession}
 * the host wires via a {@link SandboxAdapter}) and never imports any execution
 * provider. The agent reads uploaded documents from `/mnt/files` and writes
 * outputs to `/mnt/output`; files produced there are persisted as workflow
 * artifacts via `ctx.addArtifact` — out of band, so their bytes never re-enter
 * the model's message stream (only a short text summary does).
 *
 * Register it on the host's AgentToolRegistry:
 *   toolRegistry.register(runCodeTool)
 * and provide a SandboxAdapter via `RuntimeOptions.sandbox`.
 */

import { z } from 'zod';
import type { WorkflowTool } from '../tool-types.js';

const RunCodeInput = z.object({
  language: z.enum(['python', 'bash']).default('python')
    .describe('"python" runs a Python program; "bash" runs a shell command'),
  code: z.string()
    .describe('The Python program or shell command. Read input files from /mnt/files; write any files you produce to /mnt/output.'),
});

export const runCodeTool: WorkflowTool<typeof RunCodeInput> = {
  name: 'run_code',
  description:
    'Execute Python or bash in an isolated sandbox to read, transform, or generate files. '
    + 'Uploaded documents are available at /mnt/files. Write any files you produce to /mnt/output — '
    + 'they are collected and returned as downloadable artifacts. Returns stdout/stderr and the names of produced files.',
  inputSchema: RunCodeInput,
  async execute(args, ctx) {
    const session = ctx.sandbox;
    if (!session) {
      return { error: 'Code execution is not available — no sandbox is configured for this workflow.' };
    }

    const result = args.language === 'bash'
      ? await session.bash(args.code, { signal: ctx.signal })
      : await session.exec(args.code, { signal: ctx.signal });

    // Persist files written to the output dir as artifacts (out-of-band sink).
    const producedFiles: string[] = [];
    if (ctx.addArtifact) {
      for (const artifact of result.artifacts) {
        const name = artifact.path.split('/').pop() || artifact.path;
        await ctx.addArtifact({ name, mimeType: artifact.mimeType, bytes: artifact.bytes });
        producedFiles.push(name);
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(producedFiles.length > 0 ? { producedFiles } : {}),
    };
  },
};
