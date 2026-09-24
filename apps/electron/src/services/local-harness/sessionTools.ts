import {
  listCliSessions,
  loadCliSession,
  renderTranscript,
  type CliProvider,
  type CliSessionSummary,
} from './sessionIndex';

const TOOLS = new Set(['list-cli-sessions', 'load-cli-session']);

export function isLocalSessionTool(toolName: string): boolean {
  return TOOLS.has(toolName);
}

function ageLabel(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function shortCwd(cwd: string): string {
  if (!cwd) return '';
  const home = process.env['HOME'] ?? '';
  const trimmed = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = trimmed.split('/');
  return parts.length <= 3 ? trimmed : `…/${parts.slice(-2).join('/')}`;
}

function renderList(sessions: CliSessionSummary[]): string {
  if (sessions.length === 0) {
    return 'No Codex or Claude Code CLI sessions were found on this machine.';
  }
  const lines = sessions.map((session, index) => {
    const parts = [
      `${index + 1}. [${session.provider}] ${session.sessionId}`,
      `   ${ageLabel(session.startedAt)}${session.cwd ? ` · ${shortCwd(session.cwd)}` : ''}`,
      session.preview ? `   "${session.preview}"` : '',
    ];
    return parts.filter(Boolean).join('\n');
  });
  return [
    `${sessions.length} recent CLI session${sessions.length === 1 ? '' : 's'} on this machine:`,
    '',
    ...lines,
    '',
    'Show this list to the user and ask which one to load. Pass the id to load-cli-session.',
  ].join('\n');
}

export async function callLocalSessionTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string }> {
  try {
    if (toolName === 'list-cli-sessions') {
      const providerArg = typeof args['provider'] === 'string' ? args['provider'] : 'all';
      const provider: CliProvider | 'all' =
        providerArg === 'codex' || providerArg === 'claude' ? providerArg : 'all';
      const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
      const match = typeof args['match'] === 'string' ? args['match'] : undefined;
      const sessions = await listCliSessions({
        provider,
        ...(limit === undefined ? {} : { limit }),
        ...(match === undefined ? {} : { match }),
      });
      return { ok: true, content: renderList(sessions) };
    }

    const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'].trim() : '';
    if (!sessionId) {
      return { ok: false, content: 'load-cli-session needs the sessionId from list-cli-sessions.' };
    }
    const loaded = await loadCliSession(sessionId);
    if (!loaded) {
      return {
        ok: false,
        content: `No CLI session on this machine matches ${sessionId}. Call list-cli-sessions again.`,
      };
    }
    if (loaded.turns.length === 0) {
      return { ok: false, content: `Session ${sessionId} has no readable turns.` };
    }
    return { ok: true, content: renderTranscript(loaded) };
  } catch (err) {
    return {
      ok: false,
      content: `Reading local CLI sessions failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
