import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { ReleaseTrackingMode } from '@xyne/shared';
import {
  buildCommitUrl,
  cleanDiff,
  type ChangeSectionsGroup,
} from '../../../components/Release/ChangeCards';
import type {
  CodeLanguage,
  CodeTone,
  ReleaseChangeRow,
  ReleaseCodeLine,
  RepoConfigState,
  ReleaseRepoDraft,
  ReleaseServiceDraft,
} from './SdlcReleases.types';

export const TRACK_CATEGORY = 'SdlcReleases';

export const TONE = {
  amber: 'bg-[color-mix(in_srgb,var(--status-pending)_10%,transparent)] text-status-pending',
  blue: 'bg-[color-mix(in_srgb,var(--status-scheduled)_10%,transparent)] text-status-scheduled',
  purple: 'bg-[color-mix(in_srgb,var(--status-paused)_10%,transparent)] text-status-paused',
  green: 'bg-[color-mix(in_srgb,var(--status-success)_10%,transparent)] text-status-success',
  red: 'bg-[color-mix(in_srgb,var(--status-failure)_10%,transparent)] text-status-failure',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export const REPO_CONFIG_STATE: Record<RepoConfigState, { label: string; className: string }> = {
  configured: { label: 'Configured', className: TONE.green },
  notSetUp: { label: 'Not set up', className: TONE.neutral },
  unsaved: { label: 'Unsaved', className: TONE.amber },
};

export const SERVICE_TONES = [TONE.blue, TONE.green, TONE.purple, TONE.amber, TONE.red];

export const TRACKING_MODES = [
  {
    id: ReleaseTrackingMode.COMMIT_RANGE,
    title: 'Commit range',
    fields: ['branch', 'deployed commit', 'new commit'],
  },
  { id: ReleaseTrackingMode.VERSION, title: 'Version', fields: ['release version'] },
] as const;

export const trackingModeTitle = (mode: ReleaseTrackingMode): string =>
  TRACKING_MODES.find(item => item.id === mode)?.title ?? 'Commit range';

export const plural = (count: number, word: string, pluralWord = `${word}s`): string =>
  `${count} ${count === 1 ? word : pluralWord}`;

export const releaseTitle = (ticket: { xyneId?: string | null; title: string }): string =>
  [ticket.xyneId, ticket.title].filter(Boolean).join(' · ');

export function formatReleaseDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.getFullYear() === new Date().getFullYear()
    ? format(date, 'd MMM')
    : format(date, 'd MMM yyyy');
}

export function normalizeRepoUrl(url: string): string {
  let value = url.trim();
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/i.exec(value);
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`;
  return value
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

export function repoMatchesUrl(repoUrl: string, candidateUrl: string): boolean {
  const repo = normalizeRepoUrl(repoUrl);
  const candidate = normalizeRepoUrl(candidateUrl);
  return !!repo && (candidate === repo || candidate.startsWith(`${repo}/`));
}

export function repoHostLabel(url: string): string {
  let host = '';
  try {
    host = new URL(normalizeRepoUrl(url)).hostname;
  } catch {
    return 'Repository';
  }
  if (host.includes('github')) return 'GitHub';
  if (host.includes('bitbucket')) return 'Bitbucket';
  if (host.includes('gitlab')) return 'GitLab';
  return host;
}

export const repoPath = (repoUrl: string | undefined): string =>
  repoUrl
    ? repoUrl
        .replace(/\.git$/, '')
        .split('/')
        .filter(Boolean)
        .slice(-2)
        .join('/') || repoUrl
    : '—';

export function firstBranch(baseBranch: unknown): string {
  if (Array.isArray(baseBranch)) {
    const branch = baseBranch.find((item): item is string => typeof item === 'string');
    if (branch) return branch;
  }
  return 'main';
}

export const jsonStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

type RegexState = 'empty' | 'invalid' | 'valid';

export function regexState(pattern: string): RegexState {
  if (!pattern.trim()) return 'empty';
  try {
    new RegExp(pattern.trim());
    return 'valid';
  } catch {
    return 'invalid';
  }
}

export const isServiceComplete = (service: ReleaseServiceDraft): boolean =>
  !!service.name.trim() && regexState(service.regex) === 'valid';

export function missingForSave(draft: ReleaseRepoDraft): string[] {
  return [
    !draft.channelId && 'a channel',
    draft.services.length === 0 && 'a service',
    draft.services.length > 0 &&
      !draft.services.every(isServiceComplete) &&
      'a name and regex on every service',
  ].filter((item): item is string => !!item);
}

export const newService = (patch: Partial<ReleaseServiceDraft> = {}): ReleaseServiceDraft => ({
  id: uuidv4(),
  boardId: uuidv4(),
  boardName: '',
  name: '',
  regex: '',
  ownerTeam: '',
  envPaths: [],
  migrationPaths: [],
  showPaths: false,
  ...patch,
});

export const EMPTY_REPO_DRAFT: ReleaseRepoDraft = {
  mainBoardId: '',
  mainBoardName: '',
  channelId: null,
  mode: ReleaseTrackingMode.COMMIT_RANGE,
  services: [],
};

export const CODE_TONE_CLASS: Record<CodeTone, string> = {
  plain: 'text-foreground',
  comment: 'text-muted-foreground',
  key: 'text-status-scheduled',
  value: 'text-status-success',
  keyword: 'text-status-failure',
  string: 'text-status-pending',
  number: 'text-status-scheduled',
  method: 'text-status-paused',
};

export const COMPOSITION_BAR_CLASSES = [
  'bg-primary',
  'bg-primary/60',
  'bg-primary/30',
  'bg-muted-foreground/25',
];

function codeLanguage(fileName: string): CodeLanguage {
  const name = fileName.toLowerCase();
  if (name.endsWith('.sql')) return 'SQL';
  if (/\.tsx?$/.test(name)) return 'TypeScript';
  if (/\.[cm]?jsx?$/.test(name)) return 'JavaScript';
  if (/\.ya?ml$/.test(name)) return 'YAML';
  if (name.startsWith('.env') || name.endsWith('.env')) return 'Dotenv';
  return 'Text';
}

const SQL_KEYWORDS =
  'CREATE|TABLE|INDEX|UNIQUE|ALTER|ADD|DROP|COLUMN|ON|NOT|NULL|PRIMARY|KEY|CONSTRAINT|REFERENCES|DEFAULT|TEXT|INTEGER|BOOLEAN|TIMESTAMP|JSONB';
const SQL_TOKEN = new RegExp(`("[^"]*"|\\b(?:${SQL_KEYWORDS})\\b|\\b\\d+\\b)`, 'i');
const SQL_KEYWORD = new RegExp(`^(?:${SQL_KEYWORDS})$`, 'i');
const TS_TOKEN = /(^\s*[A-Z0-9_]+(?=:)|\.\w+(?=\()|\b(?:true|false)\b|\b\d+(?:\.\d+)?\b)/;

function tokenizeCodeLine(
  line: string,
  language: CodeLanguage,
): { text: string; tone: CodeTone }[] {
  if (!line) return [{ text: ' ', tone: 'plain' }];
  if (language === 'Text') return [{ text: line, tone: 'plain' }];
  if (language === 'YAML') {
    if (/^\s*#/.test(line)) return [{ text: line, tone: 'comment' }];
    const pair = /^(\s*[\w.-]+)(:)(.*)$/.exec(line);
    return pair
      ? [
          { text: pair[1] ?? '', tone: 'key' },
          { text: ':', tone: 'plain' },
          { text: pair[3] ?? '', tone: 'value' },
        ]
      : [{ text: line, tone: 'plain' }];
  }
  if (language === 'Dotenv') {
    if (/^\s*#/.test(line)) return [{ text: line, tone: 'comment' }];
    const pair = /^([A-Za-z0-9_]+)(=)(.*)$/.exec(line);
    return pair
      ? [
          { text: pair[1] ?? '', tone: 'key' },
          { text: '=', tone: 'plain' },
          { text: pair[3] ?? '', tone: 'value' },
        ]
      : [{ text: line, tone: 'plain' }];
  }
  if (language === 'SQL' && /^\s*--/.test(line)) return [{ text: line, tone: 'comment' }];
  return line
    .split(language === 'SQL' ? SQL_TOKEN : TS_TOKEN)
    .filter(part => part !== '')
    .map(part => {
      if (language === 'SQL') {
        if (part.startsWith('"')) return { text: part, tone: 'string' };
        if (/^\d+$/.test(part)) return { text: part, tone: 'number' };
        return { text: part, tone: SQL_KEYWORD.test(part) ? 'keyword' : 'plain' };
      }
      if (/^\s*[A-Z0-9_]+$/.test(part)) return { text: part, tone: 'key' };
      if (part.startsWith('.')) return { text: part, tone: 'method' };
      if (/^(true|false)$/.test(part)) return { text: part, tone: 'keyword' };
      return { text: part, tone: /^\d/.test(part) ? 'number' : 'plain' };
    });
}

/** `…/migrations/20260921120000_add_foo/migration.sql` → name "Add foo", date "21 Sep". */
function migrationInfo(filePath: string): { name: string; date: string | null } {
  const match = /migrations\/(\d{8})\d*_([^/]+)\/[^/]+$/.exec(filePath);
  if (!match) return { name: filePath.slice(filePath.lastIndexOf('/') + 1), date: null };
  const words = (match[2] ?? '').replace(/_/g, ' ');
  const stamp = match[1] ?? '';
  const date = new Date(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
  );
  return { name: words.charAt(0).toUpperCase() + words.slice(1), date: format(date, 'd MMM') };
}

const SQL_NAME = '[`"\\[]?(\\w+)[`"\\]]?';
const SQL_TABLE = `(?:[\`"\\[]?\\w+[\`"\\]]?\\.)?${SQL_NAME}`;
const CREATE_TABLE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${SQL_TABLE}\\s*\\(`,
  'gi',
);
const ADD_COLUMN = new RegExp(
  `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${SQL_TABLE}\\s+ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${SQL_NAME}`,
  'gi',
);

function summarizeSql(sql: string): string {
  const parts: string[] = [];
  for (const match of sql.matchAll(CREATE_TABLE)) parts.push(`New table ${match[1]}`);
  for (const match of sql.matchAll(ADD_COLUMN)) parts.push(`Adds ${match[2]} to ${match[1]}`);
  const uniqueIndexes = (sql.match(/CREATE\s+UNIQUE\s+INDEX/gi) ?? []).length;
  const indexes = (sql.match(/CREATE\s+INDEX/gi) ?? []).length;
  if (uniqueIndexes) parts.push(plural(uniqueIndexes, 'unique index', 'unique indexes'));
  if (indexes) parts.push(plural(indexes, 'index', 'indexes'));
  return parts.join(' · ') || 'Schema change';
}

const envKeys = (lines: readonly string[]): string[] => [
  ...new Set(
    lines
      .map(line => /^\s*([A-Z0-9_]+)\s*[=:]/.exec(line)?.[1])
      .filter((key): key is string => !!key),
  ),
];

const splitLines = (value: string | undefined): string[] => (value ? value.split('\n') : []);

/** One row per changed env/migration file, with its commits and the lines they added. */
export function buildChangeRows(
  groups: readonly ChangeSectionsGroup[],
  valuesByChangeId: ReadonlyMap<string, Record<string, string>>,
  ticketTitleByXyneId: ReadonlyMap<string, string>,
): ReleaseChangeRow[] {
  return groups.flatMap(group =>
    group.files.map(file => {
      const kind = file.changeType === 'ENV' ? 'ENV' : 'MIGRATION';
      const fileName = file.filePath.slice(file.filePath.lastIndexOf('/') + 1);
      const language = codeLanguage(fileName);
      const lines: ReleaseCodeLine[] = [];
      const added: string[] = [];
      const removed: string[] = [];

      const commits = file.changes.map(change => {
        const values = valuesByChangeId.get(change.id) ?? {};
        const removedLines = kind === 'ENV' ? splitLines(values['oldValue']) : [];
        const addedLines =
          kind === 'ENV' ? splitLines(values['newValue']) : cleanDiff(values['changeLog'] ?? '');
        for (const line of removedLines) {
          lines.push({ number: null, tokens: tokenizeCodeLine(line, language) });
        }
        for (const line of addedLines) {
          lines.push({ number: added.length + 1, tokens: tokenizeCodeLine(line, language) });
          added.push(line);
        }
        removed.push(...removedLines);
        return {
          id: change.id,
          ticket: change.devTicketXyneId,
          ticketTitle: change.devTicketXyneId
            ? (ticketTitleByXyneId.get(change.devTicketXyneId) ?? '')
            : 'Commit not linked to a ticket',
          sha: change.commitId?.slice(0, 7) ?? null,
          commitUrl: buildCommitUrl(group.repoUrl, change.commitId),
        };
      });

      const keys = envKeys([...added, ...removed]);
      const migration = migrationInfo(file.filePath);
      const subtitle =
        kind === 'ENV'
          ? keys.length > 0
            ? `${keys.slice(0, 2).join(', ')}${keys.length > 2 ? `  +${keys.length - 2} more` : ''}`
            : file.filePath
          : [migration.date, summarizeSql(added.join('\n'))].filter(Boolean).join(' · ');

      return {
        key: `${group.appName}|${file.key}`,
        kind,
        service: group.appName,
        title: kind === 'ENV' ? fileName : migration.name,
        subtitle,
        addedLines: added.length,
        removedLines: removed.length,
        commits,
        fileName,
        language,
        lines,
        source: added.join('\n'),
      };
    }),
  );
}
