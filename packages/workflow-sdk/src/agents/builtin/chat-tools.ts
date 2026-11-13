/**
 * Tools for the conversational chat agents (Ask AI — builder + approval), which
 * run on pi-agent-core's `agentLoop` and therefore need pi-agent-core `AgentTool`
 * objects (a different shape from the workflow step's {@link WorkflowTool}).
 *
 * These wrap the same built-in {@link runCodeTool} the RUN_AGENT step uses, so
 * code execution behaves identically everywhere — always through the host's
 * {@link SandboxAdapter}, never a baked-in backend.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { SandboxAdapter, SandboxFileUpload } from '../../sandbox/types.js';
import { bindSandboxSession } from '../../sandbox/types.js';
import { zodToJsonSchemaRecord } from '../../util/schema-convert.js';
import { runCodeTool } from './run-code-tool.js';

/**
 * Wrap the built-in `run_code` {@link WorkflowTool} as a pi-agent-core
 * {@link AgentTool}, driving a fresh sandbox per call (create → run → destroy)
 * so each invocation is isolated. Always executes inside the host sandbox.
 *
 * `preloadFiles` are written into every fresh sandbox before the model's code
 * runs — the approval chat uses this to mount the execution JSON at
 * /mnt/files/execution.json so the model can read run data on demand without it
 * ever entering the prompt.
 */
export function createRunCodeAgentTool(
  sandbox: SandboxAdapter,
  preloadFiles?: SandboxFileUpload[],
): AgentTool {
  return {
    name: runCodeTool.name,
    label: 'Run code',
    description: runCodeTool.description,
    parameters: zodToJsonSchemaRecord(runCodeTool.inputSchema) as AgentTool['parameters'],
    execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal) => {
      const sig = signal ?? new AbortController().signal;
      const handle = await sandbox.create({ signal: sig });
      try {
        const session = bindSandboxSession(sandbox, handle);
        if (preloadFiles && preloadFiles.length > 0) {
          await session.writeFiles(preloadFiles);
        }
        const result = await runCodeTool.execute(params as Parameters<typeof runCodeTool.execute>[0], {
          sandbox: session,
          signal: sig,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
      } finally {
        await sandbox.destroy(handle).catch(() => { /* best-effort teardown */ });
      }
    },
  };
}

/**
 * The full tool set available to the Ask AI chat agents. Returns `run_code` when
 * a sandbox is configured, else an empty list (the chat still works, just without
 * code execution). `preloadFiles` (e.g. the execution JSON) are mounted into the
 * sandbox on every call.
 */
export function createChatAgentTools(
  sandbox: SandboxAdapter | undefined,
  preloadFiles?: SandboxFileUpload[],
): AgentTool[] {
  return sandbox ? [createRunCodeAgentTool(sandbox, preloadFiles)] : [];
}
