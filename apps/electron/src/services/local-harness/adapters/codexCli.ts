import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import log from 'electron-log/main';
import type { HarnessAdapter, HarnessRunContext, HarnessRunOutcome } from './types';
import { spawnJsonLines } from './streamJson';
import { buildAttachmentPrompt } from './attachments';

const HTML_DOC_RE = /```html\s*[\s\S]*?(?:<html[\s>]|<!doctype\s+html)/i;

const LOCAL_ITEM_TOOL_NAMES: Record<string, string> = {
  command_execution: 'local-shell',
  file_change: 'local-edit',
  web_search: 'web-search',
};

export function shellTitle(command: string): string {
  const collapsed = command.replace(/\s+/g, ' ').trim();
  const withoutShell = collapsed
    .replace(/^\/bin\/(?:ba|z)?sh\s+-l?c\s+/, '')
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim();
  const heredoc = /^(?:cat|tee)\s*>\s*(\S+)/.exec(withoutShell);
  if (heredoc) return `write ${heredoc[1]}`;
  return truncate(withoutShell, 120);
}

export function localItemArgs(item: Record<string, unknown>): Record<string, unknown> {
  if (typeof item['command'] === 'string') {
    return { title: shellTitle(item['command']), command: truncate(item['command'], 300) };
  }
  const path = firstChangedPath(item);
  if (path) return { title: `edit ${path}`, path };
  if (typeof item['query'] === 'string') {
    const query = truncate(item['query'], 200);
    return { title: query, query };
  }
  return {};
}

function itemDurationMs(item: Record<string, unknown>, startedAt: number | undefined): number {
  if (startedAt !== undefined) return Math.max(0, Date.now() - startedAt);
  const started = item['started_at'];
  const completed = item['completed_at'];
  if (typeof started === 'string' && typeof completed === 'string') {
    const span = Date.parse(completed) - Date.parse(started);
    if (Number.isFinite(span) && span >= 0) return span;
  }
  return 0;
}

export function keepStreamedDraft(finalText: string, streamed: string): string {
  if (HTML_DOC_RE.test(finalText) || !HTML_DOC_RE.test(streamed)) return finalText;
  const base = streamed.trim();
  const tail = finalText.trim();
  if (!tail || base.endsWith(tail)) return base;
  return `${base}\n\n${tail}`;
}

const TOKEN_ENV_VAR = 'XYNE_LOCAL_HARNESS_TOKEN';
const MCP_STARTUP_TIMEOUT_SEC = 60;
const MCP_TOOL_TIMEOUT_SEC = 600;

export class CodexCliAdapter implements HarnessAdapter {
  async run(ctx: HarnessRunContext): Promise<HarnessRunOutcome> {
    const { envelope } = ctx;

    const writable = !!((envelope.localSandbox && !envelope.localSandbox.container) || envelope.workspace);
    const attached = await buildAttachmentPrompt(ctx.attachmentPaths ?? []);
    const shellEnabled = writable || attached.needsFileTools;

    const prompt = [
      envelope.context ? `<context>\n${envelope.context}\n</context>` : '',
      attached.note,
      envelope.task,
    ]
      .filter(Boolean)
      .join('\n\n');

    const instructionsPath = join(tmpdir(), `xyne-codex-instructions-${randomBytes(12).toString('hex')}.md`);
    await fs.writeFile(instructionsPath, envelope.systemPrompt, { mode: 0o600 });

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
      `features.shell_tool=${shellEnabled ? 'true' : 'false'}`,
      '-c',
      'features.unified_exec=false',
      '-c',
      'web_search="disabled"',
      '-c',
      `model_instructions_file=${JSON.stringify(instructionsPath)}`,
      '-c',
      `sandbox_mode=${JSON.stringify(writable ? 'workspace-write' : 'read-only')}`,
      '-c',
      'approval_policy="never"',
      '-c',
      `mcp_servers.${ctx.mcpServerName}.url=${JSON.stringify(facadeUrl)}`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.bearer_token_env_var=${JSON.stringify(TOKEN_ENV_VAR)}`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.default_tools_approval_mode="approve"`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.startup_timeout_sec=${MCP_STARTUP_TIMEOUT_SEC}`,
      '-c',
      `mcp_servers.${ctx.mcpServerName}.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SEC}`,
    );

    for (const image of attached.images) args.push('--image', image.path);

    if (envelope.model) args.push('--model', envelope.model);

    log.info(
      `[LocalHarness] codex spawn run=${envelope.runId} tools=${ctx.toolCount} facade=${facadeUrl} ` +
        `shell=${shellEnabled ? (writable ? 'write' : 'read-only-for-attachments') : 'off'}`,
    );

    let text = '';
    let accumulatedText = '';
    let harnessSessionId: string | undefined;
    let resultError: string | undefined;
    const toolsUsed = new Set<string>();
    let tokenUsage: { input?: number; output?: number } | undefined;

    let result;
    try {
      const localItemStartedAt = new Map<string, number>();
      result = await spawnJsonLines({
        binaryPath: ctx.binaryPath,
        args,
        stdin: prompt,
        cwd: ctx.workspaceDir,
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
                  accumulatedText += item['text'];
                  ctx.onProgress({ kind: 'text', delta: item['text'] });
                }
              }

              if (
                item['type'] === 'reasoning' &&
                event['type'] === 'item.completed' &&
                typeof item['text'] === 'string' &&
                item['text']
              ) {
                ctx.onProgress({ kind: 'reasoning', delta: item['text'] });
              }

              if (event['type'] === 'item.started') {
                if (item['type'] === 'command_execution') {
                  const command = typeof item['command'] === 'string' ? item['command'] : '';
                  ctx.onProgress({ kind: 'status', label: `Running: ${truncate(command, 80)}` });
                } else if (item['type'] === 'file_change') {
                  ctx.onProgress({ kind: 'status', label: `Editing ${firstChangedPath(item) ?? 'files'}` });
                } else if (item['type'] === 'web_search') {
                  ctx.onProgress({ kind: 'status', label: 'Searching the web' });
                } else if (item['type'] === 'mcp_tool_call' && typeof item['tool'] === 'string') {
                  ctx.onProgress({ kind: 'tool', toolName: item['tool'] });
                }
              }

              const localName = LOCAL_ITEM_TOOL_NAMES[String(item['type'])];
              const localId = typeof item['id'] === 'string' ? item['id'] : '';
              if (localName && event['type'] === 'item.started' && localId) {
                localItemStartedAt.set(localId, Date.now());
              }
              if (localName && event['type'] === 'item.completed') {
                const startedAt = localId ? localItemStartedAt.get(localId) : undefined;
                if (localId) localItemStartedAt.delete(localId);
                ctx.onProgress({
                  kind: 'tool',
                  toolName: localName,
                  ...(localId ? { toolCallId: localId } : {}),
                  args: localItemArgs(item),
                  status: item['status'] === 'failed' ? 'error' : 'completed',
                  durationMs: itemDurationMs(item, startedAt),
                });
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
    } finally {
      await fs.rm(instructionsPath, { force: true }).catch(() => {});
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
      return { status: 'failed', text: '', error: 'Codex exceeded the run time limit' };
    }
    if (result.exitCode !== 0 || resultError) {
      const detail = resultError ?? result.stderr.trim();
      log.warn(`[LocalHarness] codex exit=${result.exitCode} error=${detail.slice(0, 300)}`);
      if (/mcp/i.test(result.stderr)) {
        log.warn(`[LocalHarness] codex MCP stderr tail: ${result.stderr.slice(-500)}`);
      }
      return {
        status: 'failed',
        text: '',
        error: detail || `Codex exited with code ${result.exitCode}`,
        ...(harnessSessionId ? { harnessSessionId } : {}),
      };
    }

    const finalText = keepStreamedDraft(text, accumulatedText);
    return {
      status: 'done',
      text: finalText,
      partialText: accumulatedText,
      toolsUsed: [...toolsUsed],
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(harnessSessionId ? { harnessSessionId } : {}),
    };
  }
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function firstChangedPath(item: Record<string, unknown>): string | null {
  const changes = item['changes'];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (change && typeof change === 'object') {
        const path = (change as Record<string, unknown>)['path'];
        if (typeof path === 'string' && path) return path;
      }
      if (typeof change === 'string' && change) return change;
    }
  }
  const path = item['path'];
  return typeof path === 'string' && path ? path : null;
}
