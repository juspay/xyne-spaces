import axios from 'axios';
import { CLAW_API_BASE } from './clawRequest';

export type SessionExportFormat = 'claude-project' | 'claude-code' | 'markdown';

export interface SessionExportOption {
  format: SessionExportFormat;
  label: string;
  extension: string;
  description: string;
  resumeSteps?: string;
}

export const SESSION_EXPORT_OPTIONS: readonly SessionExportOption[] = [
  {
    format: 'claude-project',
    label: 'Claude Code project',
    extension: '.zip',
    description: 'Agent prompt, skills and this chat — open it and resume in Claude Code',
    resumeSteps: `unzip ~/Downloads/<file>.zip -d ~/my-agent-project
cd ~/my-agent-project
DIR=~/.claude/projects/$(pwd | tr -c 'A-Za-z0-9\\n' '-')
mkdir -p "$DIR" && mv <file>.jsonl "$DIR"/
claude --resume <file>`,
  },
  {
    format: 'claude-code',
    label: 'Session only',
    extension: '.jsonl',
    description: 'Just the transcript, resumable in Claude Code',
    resumeSteps: `mkdir -p ~/xyne-session && cd ~/xyne-session
DIR=~/.claude/projects/$(pwd | tr -c 'A-Za-z0-9\\n' '-')
mkdir -p "$DIR" && mv ~/Downloads/<file>.jsonl "$DIR"/
claude --resume <file>`,
  },
  {
    format: 'markdown',
    label: 'Markdown',
    extension: '.md',
    description: 'A readable transcript to share or archive',
  },
];

export function sessionExportUrl(
  conversationId: string,
  agentSlug: string,
  format: SessionExportFormat,
): string {
  const qs = new URLSearchParams({ conversationId, agentSlug, format });
  return `${CLAW_API_BASE}/api/v1/runs/session/export?${qs.toString()}`;
}

export function exportFileName(
  disposition: string | null | undefined,
  conversationId: string,
  format: SessionExportFormat,
): string {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const fromHeader = match?.[1]?.trim();
  if (fromHeader) return decodeURIComponent(fromHeader);
  const option = SESSION_EXPORT_OPTIONS.find(o => o.format === format);
  return `${conversationId}${option?.extension ?? ''}`;
}

export function exportErrorMessage(status: number | undefined): string {
  if (status === 404) return 'Nothing to export yet — this chat has no finished replies';
  if (status === 401 || status === 403) return 'You don’t have access to export this chat';
  return 'Could not export this chat. Please try again.';
}

export async function downloadSessionExport(
  conversationId: string,
  agentSlug: string,
  format: SessionExportFormat,
): Promise<string> {
  try {
    const res = await axios.get<Blob>(sessionExportUrl(conversationId, agentSlug, format), {
      responseType: 'blob',
      withCredentials: true,
    });
    const fileName = exportFileName(
      res.headers['content-disposition'] as string | undefined,
      conversationId,
      format,
    );
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return fileName;
  } catch (err) {
    throw new Error(exportErrorMessage(axios.isAxiosError(err) ? err.response?.status : undefined));
  }
}

export function resumeStepsFor(format: SessionExportFormat, fileName: string): string | null {
  const steps = SESSION_EXPORT_OPTIONS.find(o => o.format === format)?.resumeSteps;
  return steps ? steps.split('<file>').join(fileName.replace(/\.(zip|jsonl)$/, '')) : null;
}
