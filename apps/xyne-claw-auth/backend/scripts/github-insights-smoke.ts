/**
 * Smoke-test every GitHub growth tool against the real API with a real PAT.
 *
 * Calls the same handlers /mcp/call dispatches to, so a green run here means
 * the tool works for an agent too — minus the connection/grant plumbing.
 * Read-only: nothing in this file mutates GitHub state.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx pnpm --filter xyne-claw-auth exec tsx --env-file=.env \
 *     scripts/github-insights-smoke.ts <owner/repo> [compare-owner/repo ...]
 *
 * (`--env-file=.env` is needed only because the shared citation helper pulls in
 * claw-auth's config module, which requires ENCRYPTION_KEY.)
 *
 * The token is the same PAT you connect in the GitHub integration. Note
 * github-repo-traffic needs PUSH access to the repo; without it that one tool
 * is expected to fail with a 403 explaining exactly that.
 */

import {
  handleListStargazers,
  handleStarHistory,
  handleStargazerProfiles,
  handleRepoTraffic,
  handleRepoSnapshot,
  handleListForks,
  handleReleaseDownloads,
  handleRepoActivity,
  handleCommunityPulse,
  handleCompareRepos,
} from "../src/mcp/adapters/github-insights.js";

const target = process.argv[2];
const token = process.env["GITHUB_TOKEN"] ?? process.env["GITHUB_PERSONAL_ACCESS_TOKEN"];

if (!target || !target.includes("/")) {
  console.error("usage: GITHUB_TOKEN=ghp_xxx tsx scripts/github-insights-smoke.ts <owner/repo> [more/repos ...]");
  process.exit(1);
}
if (!token) {
  console.error("GITHUB_TOKEN (or GITHUB_PERSONAL_ACCESS_TOKEN) must be set to the PAT you connected in Claw.");
  process.exit(1);
}

const [owner, repo] = target.split("/") as [string, string];
const credentials = { token };
const comparisons = process.argv.slice(3);

type Handler = (c: Record<string, unknown>, p: Record<string, unknown>) => Promise<{ content: string }>;

const CASES: Array<{ tool: string; run: Handler; params: Record<string, unknown> }> = [
  { tool: "github-repo-snapshot", run: handleRepoSnapshot, params: { owner, repo, splitIssues: true, includeCommunity: true } },
  { tool: "github-list-stargazers", run: handleListStargazers, params: { owner, repo, max: 10 } },
  { tool: "github-list-stargazers (enriched)", run: handleListStargazers, params: { owner, repo, max: 10, enrich: true, summaryOnly: true } },
  { tool: "github-star-history", run: handleStarHistory, params: { owner, repo, weeks: 12 } },
  { tool: "github-stargazer-profiles", run: handleStargazerProfiles, params: { owner, repo, limit: 25 } },
  { tool: "github-repo-traffic", run: handleRepoTraffic, params: { owner, repo } },
  { tool: "github-list-forks", run: handleListForks, params: { owner, repo, max: 10 } },
  { tool: "github-release-downloads", run: handleReleaseDownloads, params: { owner, repo, max: 5 } },
  { tool: "github-repo-activity", run: handleRepoActivity, params: { owner, repo, weeks: 8, metrics: ["participation", "commit_activity", "contributors"] } },
  { tool: "github-community-pulse", run: handleCommunityPulse, params: { owner, repo, days: 30, maxIssuesSampled: 5 } },
  {
    tool: "github-compare-repos",
    run: handleCompareRepos,
    params: { repos: [target, ...comparisons], includeReleases: true },
  },
];

/** First 2 lines + a size, so ten tools stay readable in one terminal. */
function preview(content: string): string {
  const body = content.slice(content.indexOf("{"));
  const head = content.split("\n")[0] ?? "";
  return `${head}\n    payload ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`;
}

let failures = 0;
for (const testCase of CASES) {
  const started = Date.now();
  try {
    const result = await testCase.run(credentials, testCase.params);
    console.log(`\n✅ ${testCase.tool}  (${Date.now() - started}ms)\n    ${preview(result.content)}`);
  } catch (error) {
    failures += 1;
    console.log(`\n❌ ${testCase.tool}  (${Date.now() - started}ms)\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} tools OK`);
process.exit(failures > 0 ? 1 : 0);
