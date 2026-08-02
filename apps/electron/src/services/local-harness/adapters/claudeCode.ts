import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import log from 'electron-log/main';
import type { HarnessAdapter, HarnessRunContext, HarnessRunOutcome } from './types';
import { spawnJsonLines } from './streamJson';

export class ClaudeCodeAdapter implements HarnessAdapter {
  async run(ctx: HarnessRunContext): Promise<HarnessRunOutcome> {
    const { envelope } = ctx;

    const prompt = ctx.envelope.context
      ? `${ctx.envelope.context}\n\n---\n\n${envelope.task}`
      : envelope.task;

    const mcpConfigPath = join(tmpdir(), `xyne-mcp-${randomBytes(12).toString('hex')}.json`);
    await fs.writeFile(mcpConfigPath, JSON.stringify(ctx.mcpConfig), { mode: 0o600 });

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt',
      envelope.systemPrompt,
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--tools',
      '',
      '--permission-mode',
      'bypassPermissions',
    ];

    if (envelope.model) args.push('--model', envelope.model);
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);

    let text = '';
    let harnessSessionId: string | undefined;
    let effectiveModel: string | undefined;
    let resultError: string | undefined;
    const toolsUsed = new Set<string>();
    let tokenUsage: { input?: number; output?: number } | undefined;

    let result;
    try {
      result = await spawnJsonLines({
        binaryPath: ctx.binaryPath,
        args,
        stdin: prompt,
        cwd: tmpdir(),
        env: { ...process.env },
        signal: ctx.signal,
        timeoutMs: envelope.timeoutMs,
        onEvent: (event) => {
          const type = event['type'];

          if (typeof event['session_id'] === 'string') harnessSessionId = event['session_id'];

          if (type === 'system' && event['subtype'] === 'init') {
            if (typeof event['model'] === 'string') effectiveModel = event['model'];
            ctx.onProgress({ kind: 'status', label: 'Starting local harness' });
            return;
          }

          if (type === 'assistant') {
            const message = event['message'] as { content?: unknown } | undefined;
            for (const block of asBlocks(message?.content)) {
              if (block['type'] === 'text' && typeof block['text'] === 'string') {
                text += block['text'];
                ctx.onProgress({ kind: 'text', delta: block['text'] });
              } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
                toolsUsed.add(block['name']);
              }
            }
            return;
          }

          if (type === 'result') {
            if (typeof event['result'] === 'string' && event['result']) text = event['result'];
            if (event['is_error'] === true) {
              resultError =
                typeof event['result'] === 'string' ? event['result'] : 'Claude Code reported an error';
            }
            const usage = event['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) tokenUsage = { input: usage.input_tokens, output: usage.output_tokens };
          }
        },
      });
    } finally {
      await fs.rm(mcpConfigPath, { force: true }).catch(() => {});
    }

    if (result.aborted) {
      return { status: 'cancelled', text: '', ...(harnessSessionId ? { harnessSessionId } : {}) };
    }
    if (result.timedOut) {
      return { status: 'failed', text: '', error: 'Claude Code exceeded the run time limit' };
    }
    if (result.exitCode !== 0 || resultError) {
      const detail = resultError ?? result.stderr.trim() ?? '';
      log.warn(`[LocalHarness] claude-code exit=${result.exitCode} error=${detail.slice(0, 300)}`);
      return {
        status: 'failed',
        text: '',
        error: detail || `Claude Code exited with code ${result.exitCode}`,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      };
    }

    return {
      status: 'done',
      text,
      toolsUsed: [...toolsUsed],
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(effectiveModel ? { effectiveModel } : {}),
      ...(harnessSessionId ? { harnessSessionId } : {}),
    };
  }
}

function asBlocks(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b));
}
