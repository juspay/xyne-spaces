import { describe, expect, it, vi, afterEach } from 'vitest';
import { classifyToolRisk } from 'xyne-claw-shared';
import {
  GITHUB_INSIGHTS_TOOLS,
  GhClient,
  fetchStargazers,
  fetchProfiles,
  handleListStargazers,
  handleStarHistory,
  handleRepoTraffic,
  handleListForks,
  handleReleaseDownloads,
  handleRepoSnapshot,
  handleCommunityPulse,
  handleCompareRepos,
  handleRepoActivity,
  isGithubInsightsTool,
  pageFromLink,
  profileAggregates,
} from './github-insights.js';

const creds = { token: 'ghp_test' };
const DAY = 86_400_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonRes(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** Install a fetch stub that answers from `routes`, first match wins. */
function stubFetch(routes: Array<[RegExp, (url: string, init?: RequestInit) => Response]>): ReturnType<typeof vi.fn> {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [pattern, respond] of routes) {
      if (pattern.test(url)) return respond(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  (fetchMock as unknown as { calls: string[] }).calls = calls;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function urlsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** star+json shaped stargazer entry, `daysAgo` before now. */
function star(login: string, daysAgo: number) {
  return {
    starred_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    user: { login, html_url: `https://github.com/${login}`, type: 'User' },
  };
}

const REF = { base: 'https://api.github.com/repos/juspay/xyne-spaces' };

describe('tool definitions', () => {
  it('exposes all ten growth tools with owner/repo required where applicable', () => {
    const names = GITHUB_INSIGHTS_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'github-list-stargazers',
      'github-star-history',
      'github-stargazer-profiles',
      'github-repo-traffic',
      'github-repo-snapshot',
      'github-list-forks',
      'github-release-downloads',
      'github-repo-activity',
      'github-community-pulse',
      'github-compare-repos',
    ]);
    for (const tool of GITHUB_INSIGHTS_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(80);
      // The tool index renders at most 12 params per tool.
      expect(Object.keys((tool.inputSchema['properties'] ?? {}) as object).length).toBeLessThanOrEqual(12);
    }
    const stargazers = GITHUB_INSIGHTS_TOOLS.find((t) => t.name === 'github-list-stargazers');
    expect(stargazers!.inputSchema['required']).toEqual(['owner', 'repo']);
    // Profiles can run off an explicit login list, so nothing is required.
    const profiles = GITHUB_INSIGHTS_TOOLS.find((t) => t.name === 'github-stargazer-profiles');
    expect(profiles!.inputSchema['required']).toEqual([]);
  });

  it('declares readOnly, because the name heuristic reads "star" as a write', () => {
    // WRITE_PATTERNS in xyne-claw-shared/tools/tool-risk.ts contains "star",
    // so classifying github-list-stargazers by name alone yields "write" and a
    // read-only open palette refuses it. The declaration is what overrides the
    // guess — claw propagates it as isWriteTool:false (apps/xyne-claw/src/mcp.ts).
    for (const tool of GITHUB_INSIGHTS_TOOLS) {
      expect({ tool: tool.name, readOnly: tool.readOnly }).toEqual({ tool: tool.name, readOnly: true });
    }
    expect(classifyToolRisk('github-list-stargazers')).toBe('write');
    expect(classifyToolRisk('github-list-stargazers', false)).toBe('read');
    expect(classifyToolRisk('github-star-history', false)).toBe('read');
  });

  it('routes only its own tool names', () => {
    expect(isGithubInsightsTool('github-list-stargazers')).toBe(true);
    expect(isGithubInsightsTool('upload-pr-attachment')).toBe(false);
    expect(isGithubInsightsTool('search_repositories')).toBe(false);
  });
});

describe('pageFromLink', () => {
  it('extracts the last page number', () => {
    const header =
      '<https://api.github.com/repositories/1/stargazers?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/stargazers?per_page=100&page=7>; rel="last"';
    expect(pageFromLink(header, 'last')).toBe(7);
    expect(pageFromLink(header, 'next')).toBe(2);
    expect(pageFromLink(null, 'last')).toBeNull();
    expect(pageFromLink('<https://x>; rel="prev"', 'last')).toBeNull();
  });
});

describe('fetchStargazers', () => {
  it('walks BACKWARDS from the last page for newest-first, because GitHub returns stars oldest-first', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => star(`old${i}`, 300 - i));
    const page3 = [star('recent-a', 5), star('recent-b', 2), star('recent-c', 1)];
    const fetchMock = stubFetch([
      [/&page=1$/, () => jsonRes(page1, { headers: { link: '<https://api.github.com/x?page=3>; rel="last"' } })],
      [/&page=3$/, () => jsonRes(page3)],
      [/&page=2$/, () => jsonRes(Array.from({ length: 100 }, (_, i) => star(`mid${i}`, 200 - i)))],
    ]);

    const result = await fetchStargazers(new GhClient('t', 'test'), 'test', REF, {
      order: 'newest',
      max: 2,
      sinceMs: null,
      untilMs: null,
    });

    // Newest entry on the last page comes first — not page 1's oldest star.
    expect(result.rows.map((r) => r.login)).toEqual(['recent-c', 'recent-b']);
    expect(urlsOf(fetchMock).some((u) => u.includes('&page=2'))).toBe(false);
    expect(result.truncatedByMax).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('stops once a whole page predates `since` and reports the set as complete', async () => {
    const page1 = [star('ancient-1', 400), star('ancient-2', 390)];
    const page2 = [star('fresh-1', 3), star('fresh-2', 1)];
    stubFetch([
      [/&page=1$/, () => jsonRes(page1, { headers: { link: '<https://api.github.com/x?page=2>; rel="last"' } })],
      [/&page=2$/, () => jsonRes(page2)],
    ]);

    const result = await fetchStargazers(new GhClient('t', 'test'), 'test', REF, {
      order: 'newest',
      max: 100,
      sinceMs: Date.now() - 30 * DAY,
      untilMs: null,
    });

    expect(result.rows.map((r) => r.login)).toEqual(['fresh-2', 'fresh-1']);
    expect(result.complete).toBe(true);
    expect(result.truncatedByMax).toBe(false);
  });

  it('walks forward for oldest-first', async () => {
    stubFetch([
      [/&page=1$/, () => jsonRes([star('first', 500), star('second', 499)], { headers: { link: '<https://api.github.com/x?page=2>; rel="last"' } })],
      [/&page=2$/, () => jsonRes([star('third', 10)])],
    ]);
    const result = await fetchStargazers(new GhClient('t', 'test'), 'test', REF, {
      order: 'oldest',
      max: 50,
      sinceMs: null,
      untilMs: null,
    });
    expect(result.rows.map((r) => r.login)).toEqual(['first', 'second', 'third']);
    expect(result.complete).toBe(true);
  });
});

describe('handleListStargazers', () => {
  it('returns a manifest with the total, recency counts and a citation', async () => {
    stubFetch([
      [/stargazers\/count/, () => jsonRes({ count: 203 })],
      [/stargazers\?/, () => jsonRes([star('b', 40), star('a', 2)])],
    ]);

    const result = await handleListStargazers(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));

    expect(payload.repo).toBe('juspay/xyne-spaces');
    expect(payload.totalStars).toBe(203);
    expect(payload.count).toBe(2);
    expect(payload.complete).toBe(true);
    expect(payload.recent.last7Days).toBe(1);
    expect(payload.recent.last30Days).toBe(1);
    expect(payload.stargazers[0].login).toBe('a');
    expect(result.citations?.[0]?.url).toBe('https://github.com/juspay/xyne-spaces/stargazers');
    // The citation token must stay on the headline so the JSON body parses.
    expect(result.content.startsWith('[clf-')).toBe(true);
  });

  it('enriches via a single batched GraphQL call rather than one request per user', async () => {
    const logins = Array.from({ length: 30 }, (_, i) => `user${i}`);
    const fetchMock = stubFetch([
      [/stargazers\/count/, () => jsonRes({ count: 30 })],
      [/stargazers\?/, () => jsonRes(logins.map((l, i) => star(l, 30 - i)))],
      [
        /graphql/,
        () =>
          jsonRes({
            data: Object.fromEntries(
              logins.map((login, i) => [
                `u${i}`,
                { login, name: `Name ${i}`, company: i < 20 ? '@juspay' : 'Acme', location: 'Bengaluru', followers: { totalCount: i }, repositories: { totalCount: 3 }, createdAt: '2019-01-01T00:00:00Z' },
              ]),
            ),
          }),
      ],
    ]);

    const result = await handleListStargazers(creds, { owner: 'juspay', repo: 'xyne-spaces', enrich: true });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));

    expect(urlsOf(fetchMock).filter((u) => u.includes('/users/')).length).toBe(0);
    expect(urlsOf(fetchMock).filter((u) => u.includes('graphql')).length).toBe(1);
    expect(payload.enrichedVia).toBe('graphql');
    expect(payload.aggregates.profiled).toBe(30);
    expect(payload.aggregates.topCompanies[0]).toEqual({ value: 'juspay', count: 20 });
    // Newest star first: user29 is 1 day old, user0 is 30 days old.
    expect(payload.stargazers[0].login).toBe('user29');
    expect(payload.stargazers.find((s: { login: string }) => s.login === 'user0').company).toBe('juspay');
  });

  it('surfaces a low rate-limit budget instead of silently burning the PAT', async () => {
    stubFetch([
      [/stargazers\/count/, () => jsonRes({ count: 1 }, { headers: { 'x-ratelimit-remaining': '42', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1800000000' } })],
      [/stargazers\?/, () => jsonRes([star('a', 1)], { headers: { 'x-ratelimit-remaining': '41', 'x-ratelimit-limit': '5000' } })],
    ]);
    const result = await handleListStargazers(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(String(payload.rateLimit)).toContain('41/5000');
  });

  it('rejects a malformed since date rather than ignoring the filter', async () => {
    stubFetch([[/./, () => jsonRes({})]]);
    await expect(handleListStargazers(creds, { owner: 'juspay', repo: 'xyne-spaces', since: 'last tuesday' })).rejects.toThrow(/not a parsable date/);
  });

  it('maps a 401 to a re-connect instruction', async () => {
    stubFetch([[/./, () => jsonRes({ message: 'Bad credentials' }, { status: 401 })]]);
    await expect(handleListStargazers(creds, { owner: 'juspay', repo: 'xyne-spaces' })).rejects.toThrow(/PAT is invalid, revoked or expired/);
  });
});

describe('fetchProfiles', () => {
  it('falls back to REST per-user lookups when GraphQL is unavailable', async () => {
    const fetchMock = stubFetch([
      [/graphql/, () => jsonRes({ errors: [{ message: 'not supported' }] })],
      [/\/users\//, (url) => {
        const login = url.split('/users/')[1] ?? '';
        return jsonRes({ login, name: `N-${login}`, company: 'Acme', followers: 5, public_repos: 2 });
      }],
    ]);
    const { profiles, via } = await fetchProfiles(new GhClient('t', 'test'), ['alice', 'bob']);
    expect(via).toBe('rest');
    expect(profiles.get('alice')?.name).toBe('N-alice');
    expect(urlsOf(fetchMock).filter((u) => u.includes('/users/')).length).toBe(2);
  });

  it('tolerates GraphQL returning null for an alias (renamed or deleted account)', async () => {
    stubFetch([
      [/graphql/, () => jsonRes({ data: { u0: { login: 'alice', followers: { totalCount: 1 } }, u1: null } })],
      [/\/users\//, () => jsonRes({ message: 'Not Found' }, { status: 404 })],
    ]);
    const { profiles, missing } = await fetchProfiles(new GhClient('t', 'test'), ['alice', 'ghost']);
    expect(profiles.size).toBe(1);
    expect(missing).toEqual(['ghost']);
  });
});

describe('profileAggregates', () => {
  it('flags a high share of brand-new accounts', () => {
    const now = Date.now();
    const fresh = new Date(now - 10 * DAY).toISOString();
    const profiles = [1, 2, 3].map((i) => ({
      login: `n${i}`, name: null, company: null, location: null, bio: null, blog: null,
      twitter: null, email: null, followers: 0, following: 0, publicRepos: 0,
      createdAt: fresh, hireable: null,
    }));
    const aggregates = profileAggregates(profiles, now) as { youngAccountRatio: number; accountsYoungerThan90Days: number };
    expect(aggregates.accountsYoungerThan90Days).toBe(3);
    expect(aggregates.youngAccountRatio).toBe(100);
  });
});

describe('handleStarHistory', () => {
  it('derives 7/30-day adds and a trend from the weekly buckets', async () => {
    const weekStart = (weeksAgo: number) => {
      const day = Math.floor(Date.now() / DAY) * DAY;
      const sunday = day - new Date(day).getUTCDay() * DAY;
      return Math.floor((sunday - weeksAgo * 7 * DAY) / 1000);
    };
    const weeks = [
      { week: weekStart(3), days: [1, 0, 0, 0, 0, 0, 0], total: 1 },
      { week: weekStart(2), days: [0, 1, 0, 0, 0, 0, 0], total: 1 },
      { week: weekStart(1), days: [2, 2, 2, 0, 0, 0, 0], total: 6 },
      { week: weekStart(0), days: [5, 0, 0, 0, 0, 0, 0], total: 5 },
    ];
    stubFetch([
      [/stargazers\/count/, () => jsonRes({ count: 120 })],
      [/stargazers\/history/, () => jsonRes(weeks)],
    ]);

    const result = await handleStarHistory(creds, { owner: 'juspay', repo: 'xyne-spaces', weeks: 8, format: 'series' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));

    expect(payload.currentStars).toBe(120);
    expect(payload.derived).toBe(false);
    expect(payload.summary.last30Days).toBe(13);
    expect(payload.summary.trend).toBe('accelerating');
    expect(payload.weeklySeries.at(-1).adds).toBe(5);
    // Cumulative is anchored to the live count and walked backwards.
    expect(payload.cumulativeByWeek.at(-1).total).toBe(120);
    expect(payload.cumulativeByWeek.at(-2).total).toBe(115);
  });

  it('falls back to starred_at reconstruction and says so when the history endpoint is absent', async () => {
    stubFetch([
      [/stargazers\/count/, () => jsonRes({ count: 3 })],
      [/stargazers\/history/, () => jsonRes({ message: 'Not Found' }, { status: 404 })],
      [/stargazers\?/, () => jsonRes([star('a', 1), star('b', 2), star('c', 3)])],
    ]);
    const result = await handleStarHistory(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.derived).toBe(true);
    expect(payload.summary.last7Days).toBe(3);
    expect(String(payload.notes[0])).toContain('DERIVED');
  });
});

describe('handleRepoTraffic', () => {
  it('explains that traffic needs push access when GitHub answers 403', async () => {
    stubFetch([[/traffic/, () => jsonRes({ message: 'Must have push access to repository' }, { status: 403, headers: { 'x-ratelimit-remaining': '4999' } })]]);
    await expect(handleRepoTraffic(creds, { owner: 'juspay', repo: 'xyne-spaces' })).rejects.toThrow(/requires PUSH access/);
  });

  it('summarises views, clones, referrers and paths', async () => {
    stubFetch([
      [/traffic\/views/, () => jsonRes({ count: 900, uniques: 120, views: [{ timestamp: '2026-09-20T00:00:00Z', count: 90, uniques: 12 }] })],
      [/traffic\/clones/, () => jsonRes({ count: 40, uniques: 22, clones: [{ timestamp: '2026-09-20T00:00:00Z', count: 4, uniques: 2 }] })],
      [/popular\/referrers/, () => jsonRes([{ referrer: 'news.ycombinator.com', count: 300, uniques: 200 }])],
      [/popular\/paths/, () => jsonRes([{ path: '/juspay/xyne-spaces', title: 'xyne', count: 500, uniques: 90 }])],
    ]);
    const result = await handleRepoTraffic(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.views.total).toBe(900);
    expect(payload.clones.uniqueCloners).toBe(22);
    expect(payload.topReferrers[0].referrer).toBe('news.ycombinator.com');
    expect(payload.topPaths[0].views).toBe(500);
    expect(result.citations?.[0]?.url).toContain('/graphs/traffic');
  });
});

describe('handleListForks', () => {
  it('separates forks with real work from drive-by copies', async () => {
    const created = new Date(Date.now() - 20 * DAY).toISOString();
    stubFetch([
      [
        /forks/,
        () =>
          jsonRes([
            { full_name: 'acme/xyne-spaces', owner: { login: 'acme' }, created_at: created, pushed_at: new Date(Date.now() - 2 * DAY).toISOString(), stargazers_count: 3 },
            { full_name: 'drive/xyne-spaces', owner: { login: 'drive' }, created_at: created, pushed_at: created, stargazers_count: 0 },
          ]),
      ],
    ]);
    const result = await handleListForks(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.count).toBe(2);
    expect(payload.activeForks).toBe(1);
    expect(payload.activeRatio).toBe(50);
    expect(payload.forks.find((f: { owner: string }) => f.owner === 'acme').active).toBe(true);
    expect(payload.complete).toBe(true);
  });
});

describe('handleReleaseDownloads', () => {
  it('totals downloads across releases and assets', async () => {
    stubFetch([
      [
        /releases/,
        () =>
          jsonRes([
            { tag_name: 'v2.0.0', published_at: '2026-09-01T00:00:00Z', assets: [{ name: 'app-darwin', download_count: 120, size: 2_097_152 }, { name: 'app-linux', download_count: 80 }] },
            { tag_name: 'v1.9.0', published_at: '2026-08-01T00:00:00Z', prerelease: true, assets: [{ name: 'app-darwin', download_count: 10 }] },
          ]),
      ],
    ]);
    const result = await handleReleaseDownloads(creds, { owner: 'juspay', repo: 'xyne-spaces' });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.totalDownloads).toBe(210);
    expect(payload.latestRelease.tag).toBe('v2.0.0');
    expect(payload.releases[0].assets[0]).toEqual({ name: 'app-darwin', downloads: 120, sizeMb: 2 });
  });
});

describe('handleRepoSnapshot', () => {
  it('reports subscribers as watchers and can split issues from PRs', async () => {
    stubFetch([
      [/search\/issues.*is%3Aissue/, () => jsonRes({ total_count: 12 })],
      [/search\/issues.*is%3Apr/, () => jsonRes({ total_count: 5 })],
      [
        /repos\/juspay\/xyne-spaces$/,
        () =>
          jsonRes({
            full_name: 'juspay/xyne-spaces',
            stargazers_count: 203,
            watchers_count: 203,
            subscribers_count: 18,
            forks_count: 30,
            open_issues_count: 17,
            pushed_at: new Date(Date.now() - 3 * DAY).toISOString(),
            license: { spdx_id: 'Apache-2.0' },
            topics: ['agents'],
          }),
      ],
    ]);
    const result = await handleRepoSnapshot(creds, { owner: 'juspay', repo: 'xyne-spaces', splitIssues: true });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.counts.watchers).toBe(18);
    expect(payload.counts.openIssuesAndPRs).toBe(17);
    expect(payload.openSplit).toEqual({ openIssues: 12, openPullRequests: 5 });
    expect(payload.dates.daysSinceLastPush).toBe(3);
  });
});

describe('handleRepoActivity', () => {
  it('splits owner commits from community commits', async () => {
    stubFetch([
      [/stats\/participation/, () => jsonRes({ all: Array(52).fill(10), owner: Array(52).fill(4) })],
      [/stats\/commit_activity/, () => jsonRes([{ week: Math.floor(Date.now() / 1000) - 604_800, total: 9, days: [1, 2, 3, 1, 1, 1, 0] }])],
    ]);
    const result = await handleRepoActivity(creds, { owner: 'juspay', repo: 'xyne-spaces', weeks: 4 });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.participation.totalCommits).toBe(40);
    expect(payload.participation.communityCommits).toBe(24);
    expect(payload.participation.communitySharePct).toBe(60);
    expect(payload.participation.ownerSplitMeaningful).toBe(true);
    expect(payload.commitActivity.totalCommits).toBe(9);
  });

  it('refuses to read an org repo\'s all-zero owner series as "100% community"', async () => {
    // Verified against juspay/xyne-spaces: GitHub reports owner=0 for all 52
    // weeks on an org-owned repo, because the owner is the org account.
    stubFetch([[/stats\/participation/, () => jsonRes({ all: Array(52).fill(10), owner: Array(52).fill(0) })]]);
    const result = await handleRepoActivity(creds, { owner: 'juspay', repo: 'xyne-spaces', metrics: ['participation'] });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.participation.ownerSplitMeaningful).toBe(false);
    expect(String(payload.participation.note)).toContain('ORG-owned');
    expect(result.content).toContain('split unavailable');
  });

  it('says the numbers are still computing instead of reporting zero activity', async () => {
    // 202 has an empty body, so this also pins the "check 202 before res.ok"
    // ordering in GhClient — reversing it yields a JSON parse error.
    stubFetch([[/stats\//, () => new Response('', { status: 202 })]]);
    vi.useFakeTimers();
    try {
      const pending = handleRepoActivity(creds, { owner: 'juspay', repo: 'xyne-spaces', metrics: ['participation'] });
      await vi.runAllTimersAsync();
      const result = await pending;
      const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
      expect(payload.participation).toBeUndefined();
      expect(String(payload.notes[0])).toContain('still computing');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handleCommunityPulse', () => {
  it('counts outside activity and names the caps it applied', async () => {
    const authors = Array.from({ length: 20 }, (_, i) => ({ user: { login: `dev${i}` } }));
    stubFetch([
      [/search\/issues.*per_page=100/, () => jsonRes({ items: authors })],
      [/search\/issues/, () => jsonRes({ total_count: 7 })],
      [/issues\/\d+\/comments/, () => jsonRes([{ created_at: new Date(Date.now() - 1 * DAY).toISOString(), user: { login: 'maintainer' } }])],
      [
        /\/issues\?state=all/,
        () => jsonRes([{ number: 1, created_at: new Date(Date.now() - 2 * DAY).toISOString(), user: { login: 'outsider' } }, { number: 2, pull_request: {}, created_at: new Date().toISOString(), user: { login: 'x' } }]),
      ],
    ]);
    const result = await handleCommunityPulse(creds, { owner: 'juspay', repo: 'xyne-spaces', days: 30, excludeLogins: ['maintainer'] });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));

    expect(payload.opened.issues).toBe(7);
    expect(payload.merged.pullRequests).toBe(7);
    expect(payload.contributors.distinctMergedAuthors).toBe(20);
    expect(payload.contributors.authorsCheckedForFirstContribution).toBe(15);
    expect(String(payload.notes[0])).toContain('only the first 15');
    // PRs are filtered out of the responsiveness sample — issue #2 is a PR.
    expect(payload.responsiveness.sampledIssues).toBe(1);
    expect(payload.responsiveness.medianFirstResponseHours).toBe(24);
  });
});

describe('handleCompareRepos', () => {
  it('isolates a failing repo instead of failing the whole comparison', async () => {
    stubFetch([
      [/repos\/juspay\/xyne-spaces$/, () => jsonRes({ full_name: 'juspay/xyne-spaces', stargazers_count: 203, forks_count: 30, subscribers_count: 18 })],
      [/repos\/ghost\/missing$/, () => jsonRes({ message: 'Not Found' }, { status: 404 })],
      [/stargazers\/history/, () => jsonRes([])],
    ]);
    const result = await handleCompareRepos(creds, { repos: ['juspay/xyne-spaces', 'ghost/missing'] });
    const payload = JSON.parse(result.content.slice(result.content.indexOf('{')));
    expect(payload.ranking[0].repo).toBe('juspay/xyne-spaces');
    expect(payload.ranking[0].stars).toBe(203);
    expect(payload.ranking[1].error).toContain('not found');
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(1);
    expect(result.content).toContain('1 could not be read');
  });

  it('rejects more than ten repos', async () => {
    stubFetch([[/./, () => jsonRes({})]]);
    await expect(handleCompareRepos(creds, { repos: Array.from({ length: 11 }, (_, i) => `o/r${i}`) })).rejects.toThrow(/at most 10 repos/);
  });
});
