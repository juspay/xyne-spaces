import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import log from 'electron-log/main';
import type { HarnessAdapter, HarnessRunContext, HarnessRunOutcome } from './types';
import { keepStreamedDraft } from './codexCli';
import { spawnJsonLines } from './streamJson';
import { buildAttachmentPrompt } from './attachments';

const MCP_STARTUP_TIMEOUT_MS = 60000;
const MCP_TOOL_TIMEOUT_MS = 600000;
const SANDBOX_TOOLS = 'Read,Write,Edit,Glob,Grep,Bash';

export class ClaudeCodeAdapter implements HarnessAdapter {
  async run(ctx: HarnessRunContext): Promise<HarnessRunOutcome> {
    const { envelope } = ctx;

    const writable = !!((envelope.localSandbox && !envelope.localSandbox.container) || envelope.workspace);

    const attached = await buildAttachmentPrompt(ctx.attachmentPaths ?? []);

    const prompt = [ctx.envelope.context, attached.note, envelope.task]
      .filter(Boolean)
      .join('\n\n---\n\n');

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
      writable
        ? SANDBOX_TOOLS
        : envelope.localSandbox?.container || attached.needsFileTools
          ? 'Read,Glob,Grep'
          : '',
      '--permission-mode',
      writable ? 'acceptEdits' : 'bypassPermissions',
    ];

    if (envelope.model) args.push('--model', envelope.model);
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);

    log.info(`[LocalHarness] claude-code spawn run=${envelope.runId} tools=${ctx.toolCount}`);

    let text = '';
    let accumulatedText = '';
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
        cwd: ctx.workspaceDir,
        env: {
          ...process.env,
          MCP_TIMEOUT: process.env['MCP_TIMEOUT'] ?? String(MCP_STARTUP_TIMEOUT_MS),
          MCP_TOOL_TIMEOUT: process.env['MCP_TOOL_TIMEOUT'] ?? String(MCP_TOOL_TIMEOUT_MS),
        },
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
                accumulatedText += block['text'];
                ctx.onProgress({ kind: 'text', delta: block['text'] });
              } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string' && block['thinking']) {
                ctx.onProgress({ kind: 'reasoning', delta: block['thinking'] });
              } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
                toolsUsed.add(block['name']);
                const label = toolStatusLabel(block['name'], block['input']);
                if (label) ctx.onProgress({ kind: 'status', label });
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
      return {
        status: 'cancelled',
        text: '',
        partialText: accumulatedText,
        toolsUsed: [...toolsUsed],
        ...(harnessSessionId ? { harnessSessionId } : {}),
      };
    }
    if (result.timedOut) {
      return { status: 'failed', text: '', error: 'Claude Code exceeded the run time limit' };
    }
    if (result.exitCode !== 0 || resultError) {
      const detail = resultError ?? result.stderr.trim() ?? '';
      log.warn(`[LocalHarness] claude-code exit=${result.exitCode} error=${detail.slice(0, 300)}`);
      if (/mcp/i.test(result.stderr)) {
        log.warn(`[LocalHarness] claude-code MCP stderr tail: ${result.stderr.slice(-500)}`);
      }
      return {
        status: 'failed',
        text: '',
        error: detail || `Claude Code exited with code ${result.exitCode}`,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      };
    }

    return {
      status: 'done',
      text: keepStreamedDraft(text, accumulatedText),
      partialText: accumulatedText,
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

function toolStatusLabel(name: string, input: unknown): string | null {
  const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (name === 'Bash') {
    const command = typeof args['command'] === 'string' ? args['command'] : '';
    return `Running: ${truncate(command, 80)}`;
  }
  if (name === 'Edit' || name === 'Write') {
    return `Editing ${pathArg(args) ?? 'files'}`;
  }
  if (name === 'Read') {
    return `Reading ${pathArg(args) ?? 'a file'}`;
  }
  return null;
}

function pathArg(args: Record<string, unknown>): string | null {
  const value = args['file_path'] ?? args['path'] ?? args['notebook_path'];
  return typeof value === 'string' && value ? value : null;
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
