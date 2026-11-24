import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import { z } from 'zod/v3';

const AnalyseReleaseConfigSchema = z.object({
  commits: variableRef(z.array(z.unknown())).describe(
    'Output items of the per-commit step: each has item.sha, steps.pull_request.output and, when a pull request was found, its changed files',
  ),
  ticketPrefix: variableRef(z.string().min(1)).describe('Prefix of the ticket IDs in pull request titles'),
  services: variableRef(z.array(z.unknown())).describe('The release configuration services'),
  subTickets: variableRef(z.array(z.unknown())).describe("The release ticket's current sub-tickets"),
});
type AnalyseReleaseConfig = z.infer<typeof AnalyseReleaseConfigSchema>;

export interface FileChange {
  filePath: string;
  commitId: string;
  status: string;
  diff: string;
}
export interface ChangeWithTicket extends FileChange {
  ticketId: string | null;
}
export interface AnalysedService {
  id: string;
  name: string;
  boardId: string;
  files: string[];
  commitIds: string[];
  ticketIds: string[];
  envChanges: ChangeWithTicket[];
  migrationChanges: ChangeWithTicket[];
}
export interface AnalysedCommit {
  sha: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  ticketId: string | null;
}

const AnalyseReleaseOutputSchema = z.object({
  commits: z.array(z.unknown()).describe('Commits that have a pull request, with the ticket ID from its title'),
  services: z.array(z.unknown()).describe('Affected services, with their tickets, env and migration changes'),
  serviceNames: z.array(z.string()),
  servicesToCreate: z.array(z.unknown()).describe('Affected services with no service ticket under the release yet'),
  commitsWithPR: z.number(),
  commitsWithTicket: z.number(),
  serviceList: z.string(),
  hasMigrationChange: z.string().describe('Yes or No'),
  hasEnvChange: z.string().describe('Yes or No'),
});
type AnalyseReleaseOutput = z.infer<typeof AnalyseReleaseOutputSchema>;

interface CommitEntry {
  error?: unknown;
  item?: { sha?: string };
  steps?: {
    pull_request?: { output?: { found?: boolean; number?: number; title?: string; url?: string } };
    if_valid_pr?: {
      output?: {
        branches?: { case_0?: { steps?: { changed_files?: { output?: { files?: ChangedFile[] } } } } };
      };
    };
  };
}
interface ChangedFile {
  path: string;
  status: string;
  patch?: string;
}
interface ServiceConfig {
  id: string;
  name: string;
  boardId: string;
  regex: string;
  envPaths: string[];
  migrationPaths: string[];
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchesAny = (path: string, patterns: string[]): boolean =>
  patterns.some((p) => path.includes(p) || path.endsWith(p));

/** Reads commits, files and tickets of a release's commit range and works out what each service changed. */
export class AnalyseReleaseStep extends BaseActionStep<typeof AnalyseReleaseConfigSchema, AnalyseReleaseOutput> {
  readonly type = 'ANALYSE_RELEASE';
  readonly configSchema = AnalyseReleaseConfigSchema;
  readonly outputSchema = AnalyseReleaseOutputSchema;
  readonly name = 'Analyse release';
  readonly description =
    "Finds the ticket of each pull request, the services each commit touched and their env and migration changes, and which service tickets the release still needs. Fails when a commit could not be read.";
  readonly category = 'release';
  readonly icon = 'ScanSearch';

  execute(config: AnalyseReleaseConfig): Promise<AnalyseReleaseOutput> {
    const entries = config.commits as CommitEntry[];
    const services = config.services as ServiceConfig[];
    const subTickets = config.subTickets as Array<{ boardId?: string }>;
    const prefix = escapeRegex(config.ticketPrefix as string);

    const atStart = new RegExp(`^(${prefix}-[0-9]+)`);
    const anywhere = new RegExp(`(?:^|[^A-Za-z0-9_])(${prefix}-[0-9]+)`);
    const ticketIdFrom = (title: string): string | null => (atStart.exec(title) ?? anywhere.exec(title))?.[1] ?? null;

    const commits: AnalysedCommit[] = [];
    const failedCommits: Array<{ sha: string; error: unknown }> = [];
    const filesBySha = new Map<string, ChangedFile[]>();
    for (const entry of entries) {
      const sha = entry.item?.sha ?? '';
      if (entry.error) {
        failedCommits.push({ sha, error: entry.error });
        continue;
      }
      const pr = entry.steps?.pull_request?.output;
      if (!pr?.found) continue;
      commits.push({
        sha,
        prNumber: pr.number ?? 0,
        prTitle: pr.title ?? '',
        prUrl: pr.url ?? '',
        ticketId: ticketIdFrom(pr.title ?? ''),
      });
      filesBySha.set(sha, entry.steps?.if_valid_pr?.output?.branches?.case_0?.steps?.changed_files?.output?.files ?? []);
    }
    if (failedCommits.length > 0) {
      // A partial analysis would move the deployed commit past commits that were never read.
      const list = failedCommits.map((c) => `${c.sha.slice(0, 8)}: ${JSON.stringify(c.error)}`).join('; ');
      return Promise.reject(new Error(`${String(failedCommits.length)} commit(s) could not be read: ${list}`));
    }
    const ticketBySha = new Map(commits.map((c) => [c.sha, c.ticketId]));
    const withTicket = (change: FileChange): ChangeWithTicket => ({
      ...change,
      ticketId: ticketBySha.get(change.commitId) ?? null,
    });

    const affected: AnalysedService[] = [];
    for (const service of services) {
      const regex = new RegExp(service.regex);
      const touched = commits
        .map((c) => ({ sha: c.sha, files: (filesBySha.get(c.sha) ?? []).filter((f) => regex.test(f.path)) }))
        .filter((c) => c.files.length > 0);
      if (touched.length === 0) continue;

      const envChanges: ChangeWithTicket[] = [];
      const migrationChanges: ChangeWithTicket[] = [];
      for (const c of touched) {
        for (const f of c.files) {
          const change = { filePath: f.path, commitId: c.sha, status: f.status, diff: f.patch ?? '' };
          if (matchesAny(f.path, service.envPaths)) envChanges.push(withTicket(change));
          else if (matchesAny(f.path, service.migrationPaths)) migrationChanges.push(withTicket(change));
        }
      }
      affected.push({
        id: service.id,
        name: service.name,
        boardId: service.boardId,
        files: [...new Set(touched.flatMap((c) => c.files.map((f) => f.path)))],
        commitIds: touched.map((c) => c.sha),
        ticketIds: [...new Set(touched.map((c) => ticketBySha.get(c.sha)).filter((id): id is string => Boolean(id)))],
        envChanges,
        migrationChanges,
      });
    }

    const existingBoards = new Set(subTickets.map((s) => s.boardId));
    return Promise.resolve({
      commits,
      services: affected,
      serviceNames: affected.map((s) => s.name),
      servicesToCreate: affected
        .filter((s) => !existingBoards.has(s.boardId))
        .map(({ id, name, boardId }) => ({ id, name, boardId })),
      commitsWithPR: commits.length,
      commitsWithTicket: commits.filter((c) => c.ticketId).length,
      serviceList: affected.map((s) => s.name).join(', '),
      hasMigrationChange: affected.some((s) => s.migrationChanges.length > 0) ? 'Yes' : 'No',
      hasEnvChange: affected.some((s) => s.envChanges.length > 0) ? 'Yes' : 'No',
    });
  }
}
