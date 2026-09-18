import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import type { LocalHarnessSandboxSpec, LocalHarnessToolSpec } from './contract';

export const DELIVER_MAX_FILES = 20;
export const DELIVER_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_SKILL_PROMPT_BYTES = 400 * 1024;

export const SANDBOX_TOOL_DELIVER = 'deliver-files';
export const SANDBOX_TOOL_OPEN_FILE = 'page-open-file';
export const SERVER_OPEN_URL_TOOL = 'open-url';

const DELIVER_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export function deliverMimeType(filePath: string): string {
  return DELIVER_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function isJobsPath(relative: string): boolean {
  return relative === '.xyne-jobs' || relative.startsWith('.xyne-jobs/');
}

export function resolveInRunDir(runDir: string, candidate: unknown): { path: string; relative: string } | null {
  if (typeof candidate !== 'string') return null;
  const raw = candidate.trim();
  if (!raw || raw.includes('\0')) return null;

  const rootReal = resolve(runDir);
  const target = isAbsolute(raw) ? resolve(raw) : resolve(join(rootReal, raw));
  const rel = relative(rootReal, target);
  if (!rel || rel.startsWith('..') || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return { path: target, relative: rel.split(sep).join('/') };
}

export function sandboxFileUrl(baseUrl: string, runDirName: string, relPath: string): string {
  const encoded = relPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${baseUrl}/runs/${encodeURIComponent(runDirName)}/${encoded}`;
}

export const CONTAINER_TOOLS = new Set([
  'container-run',
  'container-run-detached',
  'container-poll-job',
  'container-write-file',
  'container-read-file',
  'container-edit-file',
]);

function containerSection(runDir: string): string {
  return [
    '## Container sandbox',
    '',
    `You are running through the Xyne desktop app. Your commands execute inside an isolated Linux container on the user's machine; \`/workspace\` inside the container is the run folder (\`${runDir}\` on the host) and it persists across every turn of this conversation.`,
    '',
    '- Run commands with `container-run` (installs, builds, tests, scripts). Use `container-run-detached` plus `container-poll-job` for anything that may take longer than a minute.',
    '- Create and change files with `container-write-file`, `container-edit-file` and `container-read-file`, using workspace-relative paths.',
    '- The host machine is never touched, so no command needs approval. Do not ask the user for permission to run something.',
    `- To show the user an HTML file, call \`${SANDBOX_TOOL_OPEN_FILE}\` with its workspace-relative path, then inspect it with \`page-read\`, \`page-snapshot\` and \`page-screenshot\`.`,
    `- When your work produces files, finish by calling \`${SANDBOX_TOOL_DELIVER}\` with the final file path(s). Files do not reach the user until you deliver them; plain answers do.`,
  ].join('\n');
}

export function buildConnectedToolsSection(tools: LocalHarnessToolSpec[]): string {
  const groups = new Map<string, number>();
  for (const tool of tools) {
    const key = tool.serverType === 'local' ? 'workspace' : tool.serverType;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const summary = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');
  return [
    '## Connected integrations',
    '',
    `The tools available to you in this session ARE the user's connected integrations: ${summary}.`,
    'They are already authorised and ready to call on the user\'s behalf.',
    '',
    '- If a tool for something exists in your tool list, that integration IS connected. Say so, and use it.',
    '- Ignore any other list of plugins, connectors or integrations that appears in this conversation and',
    '  describes things as "available but not installed". That list is not about this workspace and does not',
    '  reflect what the user has connected. Never tell the user something is not connected because of it,',
    '  and never suggest installing a plugin.',
    '- When the user asks whether something is connected, answer from your tool list alone.',
  ].join('\n');
}

export function buildSandboxPrompt(base: string, sandbox: LocalHarnessSandboxSpec, runDir: string): string {
  if (sandbox.container) {
    const sections = [base, containerSection(runDir), ...(sandbox.instruction.trim() ? [sandbox.instruction] : []), ...renderSkills(sandbox.skills)];
    return sections.filter((part) => part && part.trim().length > 0).join('\n\n');
  }
  const sections = [
    base,
    [
      '## Local sandbox',
      '',
      `You are running through the Xyne desktop app as a command-line agent on the user's own machine. Your working directory is \`${runDir}\` and it persists across every turn of this conversation.`,
      '',
      '- Create and edit files inside that working directory. Never write outside it.',
      `- To show the user an HTML file, call \`${SANDBOX_TOOL_OPEN_FILE}\` with its workspace-relative path. That renders it in the workspace panel beside the chat.`,
      '- After opening a file, inspect it with `page-read` and `page-snapshot` and fix what looks wrong before you continue.',
      `- When your work produces files, finish by calling \`${SANDBOX_TOOL_DELIVER}\` with the final file path(s). Files do not reach the user until you deliver them; plain answers do.`,
    ].join('\n'),
    ...(sandbox.instruction.trim() ? [sandbox.instruction] : []),
    ...renderSkills(sandbox.skills),
  ];
  return sections.filter((part) => part && part.trim().length > 0).join('\n\n');
}

function renderSkills(skills: LocalHarnessSandboxSpec['skills']): string[] {
  const rendered: string[] = [];
  let used = 0;
  let truncated = 0;

  for (const skill of skills) {
    const block = `### Skill: ${skill.name}\n${skill.content}`;
    const size = Buffer.byteLength(block, 'utf8');
    if (used + size > MAX_SKILL_PROMPT_BYTES) {
      truncated += 1;
      continue;
    }
    used += size;
    rendered.push(block);
  }

  if (truncated > 0) {
    rendered.push(`_${truncated} additional skill(s) were omitted because the instructions exceeded the size limit._`);
  }
  return rendered;
}
