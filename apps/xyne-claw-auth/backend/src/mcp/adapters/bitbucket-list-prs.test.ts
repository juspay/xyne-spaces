import { describe, expect, it, vi, afterEach } from "vitest";
import { handleListPullRequests } from "./bitbucket.js";

const CREDS = { username: "u", token: "t", baseUrl: "https://bitbucket.example.net" };

interface FakePr { id: number; toRef?: string }

/** Serve `total` PRs in pages of 100, recording the URLs requested. */
function mockPages(pages: Array<{ values: FakePr[]; isLastPage: boolean; nextPageStart?: number }>) {
  const urls: string[] = [];
  let call = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const page = pages[Math.min(call++, pages.length - 1)]!;
    return {
      ok: true,
      json: async () => ({
        values: page.values.map((p) => ({
          id: p.id,
          title: `PR ${p.id}`,
          state: "MERGED",
          toRef: { displayId: p.toRef ?? "vpa-beta", id: `refs/heads/${p.toRef ?? "vpa-beta"}` },
          fromRef: { displayId: "feature/x" },
        })),
        size: page.values.length,
        isLastPage: page.isLastPage,
        ...(page.nextPageStart !== undefined ? { nextPageStart: page.nextPageStart } : {}),
      }),
    } as unknown as Response;
  }));
  return urls;
}

async function run(params: Record<string, unknown> = {}) {
  const res = await handleListPullRequests(CREDS, {
    projectKey: "JBIZ",
    repoSlug: "ardra-b2b",
    state: "MERGED",
    targetBranch: "vpa-beta",
    ...params,
  });
  return JSON.parse(res.content) as {
    count: number; complete: boolean; truncatedByMax: boolean; pagesWalked: number;
    ids: number[]; targetBranchMismatches?: Array<{ id: number }>;
  };
}

const prs = (from: number, n: number, toRef?: string): FakePr[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, ...(toRef ? { toRef } : {}) }));

afterEach(() => vi.unstubAllGlobals());

describe("handleListPullRequests", () => {
  it("pushes the target-branch filter SERVER-side, not client-side", async () => {
    const urls = mockPages([{ values: prs(1, 5), isLastPage: true }]);
    await run();
    expect(urls[0]).toContain("at=refs%2Fheads%2Fvpa-beta");
    // Without direction=INCOMING, `at` also matches PRs merged FROM the branch.
    expect(urls[0]).toContain("direction=INCOMING");
    expect(urls[0]).toContain("state=MERGED");
  });

  it("accepts refs/heads/<branch> and a bare branch name identically", async () => {
    const urls = mockPages([{ values: prs(1, 1), isLastPage: true }]);
    await run({ targetBranch: "refs/heads/vpa-beta" });
    expect(urls[0]).toContain("at=refs%2Fheads%2Fvpa-beta");
  });

  it("walks every page and reports complete=true only when Bitbucket said isLastPage", async () => {
    mockPages([
      { values: prs(1, 100), isLastPage: false, nextPageStart: 100 },
      { values: prs(101, 100), isLastPage: false, nextPageStart: 200 },
      { values: prs(201, 40), isLastPage: true },
    ]);
    const m = await run();
    expect(m.count).toBe(240);
    expect(m.pagesWalked).toBe(3);
    expect(m.complete).toBe(true);
    expect(m.ids[0]).toBe(1);
    expect(m.ids.at(-1)).toBe(240);
  });

  it("reports complete=false when the result set is cut short by max — no false 'all N mined' claim", async () => {
    mockPages([
      { values: prs(1, 100), isLastPage: false, nextPageStart: 100 },
      { values: prs(101, 100), isLastPage: false, nextPageStart: 200 },
    ]);
    const m = await run({ max: 150 });
    expect(m.count).toBe(150);
    expect(m.truncatedByMax).toBe(true);
    expect(m.complete).toBe(false);
  });

  it("surfaces a target-branch mismatch instead of silently dropping it", async () => {
    mockPages([{ values: [...prs(1, 3), { id: 99, toRef: "main" }], isLastPage: true }]);
    const m = await run();
    expect(m.ids).not.toContain(99);
    expect(m.targetBranchMismatches?.[0]?.id).toBe(99);
  });

  it("terminates when the server omits isLastPage and stops advancing", async () => {
    mockPages([{ values: prs(1, 100), isLastPage: false, nextPageStart: 0 }]);
    const m = await run();
    expect(m.count).toBe(100);
    expect(m.complete).toBe(false);
  });

  it("terminates on an empty page rather than looping", async () => {
    mockPages([
      { values: prs(1, 100), isLastPage: false, nextPageStart: 100 },
      { values: [], isLastPage: false },
    ]);
    const m = await run();
    expect(m.count).toBe(100);
    expect(m.complete).toBe(true);
  });

  it("omits per-PR rows under idsOnly but keeps the id manifest", async () => {
    mockPages([{ values: prs(1, 3), isLastPage: true }]);
    const res = await handleListPullRequests(CREDS, {
      projectKey: "JBIZ", repoSlug: "ardra-b2b", targetBranch: "vpa-beta", idsOnly: true,
    });
    const m = JSON.parse(res.content) as Record<string, unknown>;
    expect(m["pullRequests"]).toBeUndefined();
    expect(m["ids"]).toEqual([1, 2, 3]);
  });
});
