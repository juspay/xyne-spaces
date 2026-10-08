import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { claudeProjectsRoot, codexSessionsRoot, isValidSessionId } from './sessionFiles';

export type CliProvider = 'codex' | 'claude';

export interface CliSessionSummary {
  provider: CliProvider;
  sessionId: string;
  path: string;
  cwd: string;
  startedAt: string;
  sizeBytes: number;
  preview: string;
}

export interface LoadedCliSession {
  summary: CliSessionSummary;
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
  truncated: boolean;
}

const MAX_SCAN_FILES = 400;
const PREVIEW_CHARS = 160;
const HEAD_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_CHARS = 24000;
const MAX_TURN_CHARS = 2000;

async function listJsonl(root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, left: number): Promise<void> => {
    if (found.length >= MAX_SCAN_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_SCAN_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (left > 0) await visit(full, left - 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        found.push(full);
      }
    }
  };
  await visit(root, depth);
  return found;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const row = part as Record<string, unknown>;
          if (typeof row['text'] === 'string') return row['text'];
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (typeof row['text'] === 'string') return row['text'];
    if (row['content'] !== undefined) return textOf(row['content']);
  }
  return '';
}

function parseLines(raw: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === 'object') rows.push(value as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return rows;
}

export function turnsFromCodex(rows: Array<Record<string, unknown>>): LoadedCliSession['turns'] {
  const turns: LoadedCliSession['turns'] = [];
  for (const row of rows) {
    const payload = (row['payload'] ?? row) as Record<string, unknown>;
    const type = String(row['type'] ?? payload['type'] ?? '');
    if (type === 'session_meta') continue;
    const role = payload['role'];
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textOf(payload['content'] ?? payload['text']).trim();
    if (text) turns.push({ role, text });
  }
  return turns;
}

export function turnsFromClaude(rows: Array<Record<string, unknown>>): LoadedCliSession['turns'] {
  const turns: LoadedCliSession['turns'] = [];
  for (const row of rows) {
    const type = String(row['type'] ?? '');
    if (type !== 'user' && type !== 'assistant') continue;
    const message = (row['message'] ?? {}) as Record<string, unknown>;
    const text = textOf(message['content'] ?? row['content']).trim();
    if (text) turns.push({ role: type, text });
  }
  return turns;
}

function previewFrom(turns: LoadedCliSession['turns']): string {
  const first = turns.find(turn => turn.role === 'user');
  const text = (first?.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

async function summarise(path: string, provider: CliProvider): Promise<CliSessionSummary | null> {
  let stat;
  try {
    stat = await fs.stat(path);
  } catch {
    return null;
  }

  let head = '';
  try {
    const handle = await fs.open(path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
      await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }

  const rows = parseLines(head);
  const meta = rows.find(row => String(row['type'] ?? '') === 'session_meta');
  const metaPayload = (meta?.['payload'] ?? {}) as Record<string, unknown>;
  const sessionId =
    typeof metaPayload['session_id'] === 'string'
      ? metaPayload['session_id']
      : (basename(path).replace(/\.jsonl$/i, '').match(/([0-9a-f-]{8,})$/i)?.[1] ?? '');
  if (!sessionId || !isValidSessionId(sessionId)) return null;

  const turns = provider === 'codex' ? turnsFromCodex(rows) : turnsFromClaude(rows);
  const cwd =
    typeof metaPayload['cwd'] === 'string'
      ? metaPayload['cwd']
      : (rows.find(row => typeof row['cwd'] === 'string')?.['cwd'] as string | undefined) ?? '';

  return {
    provider,
    sessionId,
    path,
    cwd,
    startedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    preview: previewFrom(turns),
  };
}

export async function listCliSessions(options: {
  provider?: CliProvider | 'all';
  limit?: number;
  match?: string;
}): Promise<CliSessionSummary[]> {
  const provider = options.provider ?? 'all';
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 50);
  const needle = (options.match ?? '').trim().toLowerCase();

  const paths: Array<{ path: string; provider: CliProvider }> = [];
  if (provider === 'codex' || provider === 'all') {
    for (const path of await listJsonl(codexSessionsRoot(), 4)) paths.push({ path, provider: 'codex' });
  }
  if (provider === 'claude' || provider === 'all') {
    for (const path of await listJsonl(claudeProjectsRoot(), 2)) paths.push({ path, provider: 'claude' });
  }

  const summaries: CliSessionSummary[] = [];
  for (const entry of paths) {
    const summary = await summarise(entry.path, entry.provider);
    if (!summary) continue;
    if (needle) {
      const haystack = `${summary.preview} ${summary.cwd}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    summaries.push(summary);
  }

  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries.slice(0, limit);
}

export async function loadCliSession(sessionId: string): Promise<LoadedCliSession | null> {
  if (!isValidSessionId(sessionId)) return null;
  const all = await listCliSessions({ provider: 'all', limit: 50 });
  const summary =
    all.find(entry => entry.sessionId === sessionId) ??
    all.find(entry => entry.sessionId.startsWith(sessionId));
  if (!summary) return null;

  let raw = '';
  try {
    raw = await fs.readFile(summary.path, 'utf8');
  } catch {
    return null;
  }

  const rows = parseLines(raw);
  const turns = summary.provider === 'codex' ? turnsFromCodex(rows) : turnsFromClaude(rows);
  return { summary, turns, truncated: false };
}

export function renderTranscript(session: LoadedCliSession): string {
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;

  for (const turn of [...session.turns].reverse()) {
    const text = turn.text.length > MAX_TURN_CHARS ? `${turn.text.slice(0, MAX_TURN_CHARS)}…` : turn.text;
    const block = `${turn.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
    if (used + block.length > MAX_TRANSCRIPT_CHARS) {
      dropped += 1;
      continue;
    }
    used += block.length;
    lines.unshift(block);
  }

  const header = [
    `Loaded ${session.summary.provider} CLI session ${session.summary.sessionId}`,
    session.summary.cwd ? `Working directory: ${session.summary.cwd}` : '',
    `Started: ${session.summary.startedAt}`,
    dropped > 0 ? `${dropped} earlier turns omitted to fit the context budget.` : '',
    '',
  ].filter(Boolean);

  return [...header, ...lines].join('\n');
}
