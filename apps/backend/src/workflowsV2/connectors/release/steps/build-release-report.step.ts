import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import { z } from 'zod/v3';
import type { AnalysedCommit, AnalysedService, ChangeWithTicket } from './analyse-release.step';

const BuildReleaseReportConfigSchema = z.object({
  owner: variableRef(z.string().min(1)).describe('Repository owner'),
  repo: variableRef(z.string().min(1)).describe('Repository name'),
  deployedCommitId: variableRef(z.string()).describe('First commit of the range'),
  newCommitId: variableRef(z.string()).describe('Last commit of the range'),
  totalCommits: variableRef(z.number()).describe('Number of commits in the range'),
  commits: variableRef(z.array(z.unknown())).describe('Commits with a pull request, from the release analysis'),
  services: variableRef(z.array(z.unknown())).describe('Affected services, from the release analysis'),
});
type BuildReleaseReportConfig = z.infer<typeof BuildReleaseReportConfigSchema>;

const BuildReleaseReportOutputSchema = z.object({ report: z.string().describe('The analysis report, in markdown') });
type BuildReleaseReportOutput = z.infer<typeof BuildReleaseReportOutputSchema>;

const short = (sha: string): string => sha.slice(0, 8);

const envVariables = (changes: ChangeWithTicket[]): Array<{ name: string; status: string }> => {
  const seen = new Map<string, Set<string>>();
  for (const change of changes) {
    for (const line of change.diff.split('\n')) {
      const match = /^([+-])\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]/.exec(line);
      if (!match?.[1] || !match[2]) continue;
      const signs = seen.get(match[2]) ?? new Set<string>();
      signs.add(match[1]);
      seen.set(match[2], signs);
    }
  }
  return [...seen.entries()]
    .map(([name, signs]) => ({ name, status: signs.size === 2 ? 'MODIFIED' : signs.has('+') ? 'ADDED' : 'DELETED' }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const uniqueFiles = (changes: ChangeWithTicket[]): Array<{ filePath: string; commitId: string }> => {
  const byPath = new Map<string, string>();
  for (const change of changes) if (!byPath.has(change.filePath)) byPath.set(change.filePath, change.commitId);
  return [...byPath.entries()].map(([filePath, commitId]) => ({ filePath, commitId }));
};

export class BuildReleaseReportStep extends BaseActionStep<
  typeof BuildReleaseReportConfigSchema,
  BuildReleaseReportOutput
> {
  readonly type = 'BUILD_RELEASE_REPORT';
  readonly configSchema = BuildReleaseReportConfigSchema;
  readonly outputSchema = BuildReleaseReportOutputSchema;
  readonly name = 'Build release report';
  readonly description =
    'Writes the release analysis report: summary, then per service its pull requests, env variables and migrations.';
  readonly category = 'release';
  readonly icon = 'FileText';

  execute(config: BuildReleaseReportConfig): Promise<BuildReleaseReportOutput> {
    const owner = config.owner as string;
    const repo = config.repo as string;
    const commits = config.commits as AnalysedCommit[];
    const services = config.services as AnalysedService[];
    const commitUrl = (sha: string): string => `https://github.com/${owner}/${repo}/commit/${sha}`;

    const allEnv = new Set<string>();
    const allMigrations = new Set<string>();
    const sections = services.map((service) => {
      const shas = new Set(service.commitIds);
      const env = envVariables(service.envChanges);
      const migrations = uniqueFiles(service.migrationChanges);
      env.forEach((v) => allEnv.add(v.name));
      migrations.forEach((m) => allMigrations.add(m.filePath));

      const prs: Array<AnalysedCommit & { shas: Set<string> }> = [];
      for (const commit of commits) {
        if (!shas.has(commit.sha)) continue;
        let pr = prs.find((p) => p.prNumber === commit.prNumber);
        if (!pr) {
          pr = { ...commit, shas: new Set() };
          prs.push(pr);
        }
        pr.shas.add(commit.sha);
        if (!pr.ticketId && commit.ticketId) pr.ticketId = commit.ticketId;
      }

      const lines = [`## 🚀 ${service.name}`, `${prs.length} PRs • ${migrations.length} migrations • ${env.length} env vars`];
      const changeLines = [
        ...env.map((v) => `- 🔧 \`${v.name}\` **[${v.status}]**`),
        ...migrations.map((m) => `- 🗃️ [View Diff →](${commitUrl(m.commitId)}) \`${m.filePath}\``),
      ];
      if (changeLines.length > 0) lines.push('', ...changeLines);
      for (const pr of prs) {
        lines.push('', `### PR #${pr.prNumber}: ${pr.prTitle}`, `**URL:** [${pr.prUrl}](${pr.prUrl})`);
        if (pr.ticketId) lines.push('', `**Ticket:** ${pr.ticketId}`);
        const prEnv = envVariables(service.envChanges.filter((c) => pr.shas.has(c.commitId)));
        if (prEnv.length > 0) {
          lines.push('', '**Environment Changes:**', ...prEnv.map((v) => `- \`${v.name}\` **[${v.status}]**`));
        }
        const prMigrations = uniqueFiles(service.migrationChanges.filter((c) => pr.shas.has(c.commitId)));
        if (prMigrations.length > 0) {
          lines.push(
            '',
            '**Migration Changes:**',
            ...prMigrations.map((m) => `- [View Diff →](${commitUrl(m.commitId)}) \`${m.filePath}\``),
          );
        }
      }
      return lines.join('\n');
    });

    const report = [
      `**Repository:** ${owner}/${repo}`,
      '',
      `**Commit Range:** ${short(config.deployedCommitId as string)}...${short(config.newCommitId as string)}`,
      '',
      '## 📊 Summary',
      `${String(config.totalCommits)} commits analyzed • ${commits.length} with PRs • ${commits.filter((c) => c.ticketId).length} with tickets`,
      '',
      '## ⚙️ Configuration Changes',
      `**Migration Changes:** ${allMigrations.size > 0 ? `Yes (${allMigrations.size} files)` : 'No'}`,
      '',
      `**Environment Changes:** ${allEnv.size > 0 ? `Yes (${allEnv.size} variables)` : 'No'}`,
      ...sections.flatMap((s) => ['', s]),
    ].join('\n');
    return Promise.resolve({ report });
  }
}
