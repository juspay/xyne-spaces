import { tmpdir } from 'os';
import log from 'electron-log/main';
import type { HarnessAdapter, HarnessRunContext, HarnessRunOutcome } from './types';
import { spawnJsonLines } from './streamJson';

const TOKEN_ENV_VAR = 'XYNE_LOCAL_HARNESS_TOKEN';

export class CodexCliAdapter implements HarnessAdapter {
  async run(ctx: HarnessRunContext): Promise<HarnessRunOutcome> {
    const { envelope } = ctx;

    const prompt = [
      `<system>\n${envelope.systemPrompt}\n</system>`,
      envelope.context ? `<context>\n${envelope.context}\n</context>` : '',
      envelope.task,
    ]
      .filter(Boolean)
      .join('\n\n');

    const facade = (ctx.mcpConfig['mcpServers'] as Record<string, { url?: string; headers?: Record<string, string> }>)[
      ctx.mcpServerName
    ];
    const facadeUrl = facade?.url ?? '';
    const facadeToken = (facade?.headers?.['Authorization'] ?? '').replace(/^Bearer\s+/i, '');

    const args = ['exec'];
    if (ctx.resumeSessionId) args.push('resume', ctx.resumeSessionId);

    args.push(
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '-c',
      'features.shell_tool=false',
      '-c',
      'features.unified_exec=false',
      '-c',
      'features.web_search_request=false',
      '-c',
      'sandbox_mode="read-only"',
      '-c',
      'approval_policy="never"',
      '-c',
      `mcp_servers.${ctx.mcpServerName}.url=${JSON.stringify(facadeUrl)}`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.bearer_token_env_var=${JSON.stringify(TOKEN_ENV_VAR)}`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.default_tools_approval_mode="approve"`,
    );

    if (envelope.model) args.push('--model', envelope.model);

    let text = '';
    let harnessSessionId: string | undefined;
    let resultError: string | undefined;
    const toolsUsed = new Set<string>();
    let tokenUsage: { input?: number; output?: number } | undefined;

    const result = await spawnJsonLines({
      binaryPath: ctx.binaryPath,
      args,
      stdin: prompt,
      cwd: tmpdir(),
      env: { ...process.env, [TOKEN_ENV_VAR]: facadeToken },
      signal: ctx.signal,
      timeoutMs: envelope.timeoutMs,
      onEvent: (event) => {
        switch (event['type']) {
          case 'thread.started':
            if (typeof event['thread_id'] === 'string') harnessSessionId = event['thread_id'];
            ctx.onProgress({ kind: 'status', label: 'Starting local harness' });
            break;

          case 'item.started':
          case 'item.completed': {
            const item = event['item'] as Record<string, unknown> | undefined;
            if (!item) break;

            if (item['type'] === 'agent_message' && event['type'] === 'item.completed') {
              if (typeof item['text'] === 'string' && item['text']) {
                text = item['text'];
                ctx.onProgress({ kind: 'text', delta: item['text'] });
              }
            }

            if (item['type'] === 'mcp_tool_call' && typeof item['tool'] === 'string') {
              toolsUsed.add(item['tool']);
              const err = item['error'] as { message?: unknown } | null | undefined;
              if (event['type'] === 'item.completed' && item['status'] === 'failed' && err) {
                log.warn(`[LocalHarness] codex MCP tool ${String(item['tool'])} failed: ${String(err.message)}`);
              }
            }
            break;
          }

          case 'turn.completed': {
            const usage = event['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) tokenUsage = { input: usage.input_tokens, output: usage.output_tokens };
            break;
          }

          case 'turn.failed':
          case 'error':
            resultError =
              typeof event['message'] === 'string' ? event['message'] : 'Codex reported an error';
            break;
        }
      },
    });

    if (result.aborted) {
      return { status: 'cancelled', text: '', ...(harnessSessionId ? { harnessSessionId } : {}) };
    }
    if (result.timedOut) {
      return { status: 'failed', text: '', error: 'Codex exceeded the run time limit' };
    }
    if (result.exitCode !== 0 || resultError) {
      const detail = resultError ?? result.stderr.trim();
      log.warn(`[LocalHarness] codex exit=${result.exitCode} error=${detail.slice(0, 300)}`);
      return {
        status: 'failed',
        text: '',
        error: detail || `Codex exited with code ${result.exitCode}`,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      };
    }

    return {
      status: 'done',
      text,
      toolsUsed: [...toolsUsed],
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(harnessSessionId ? { harnessSessionId } : {}),
    };
  }
}
