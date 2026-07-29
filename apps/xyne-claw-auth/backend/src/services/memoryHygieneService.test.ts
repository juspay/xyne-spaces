import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collapseDuplicates,
  clusterDuplicateLinks,
  configuredBanks,
  type DuplicateLinkRow,
} from "./memoryHygieneService.js";

function link(
  fromUnitId: string,
  toUnitId: string,
  overrides: Partial<DuplicateLinkRow> = {},
): DuplicateLinkRow {
  return {
    fromUnitId,
    toUnitId,
    linkType: "semantic",
    weight: 0.99,
    fromFactType: "world",
    toFactType: "world",
    fromCreatedAt: "2026-07-20T02:00:00.000Z",
    toCreatedAt: "2026-07-20T03:00:00.000Z",
    ...overrides,
  };
}

describe("clusterDuplicateLinks", () => {
  it("builds transitive clusters and keeps the oldest fact as canonical", () => {
    const clusters = clusterDuplicateLinks([
      link("newest", "middle", {
        fromCreatedAt: "2026-07-20T03:00:00.000Z",
        toCreatedAt: "2026-07-20T02:00:00.000Z",
      }),
      link("middle", "oldest", {
        fromCreatedAt: "2026-07-20T02:00:00.000Z",
        toCreatedAt: "2026-07-20T01:00:00.000Z",
      }),
    ]);

    expect(clusters).toEqual([
      { canonical: "oldest", dups: ["middle", "newest"], size: 3 },
    ]);
  });

  it("returns separate connected components ordered by largest first", () => {
    const clusters = clusterDuplicateLinks([
      link("a", "b"),
      link("x", "y"),
      link("y", "z", {
        fromCreatedAt: "2026-07-20T03:00:00.000Z",
        toCreatedAt: "2026-07-20T04:00:00.000Z",
      }),
    ]);

    expect(clusters.map((cluster) => cluster.size)).toEqual([3, 2]);
    expect(clusters[0]).toEqual({ canonical: "x", dups: ["y", "z"], size: 3 });
  });

  it("ignores weak, non-semantic, and observation links", () => {
    const clusters = clusterDuplicateLinks([
      link("weak-a", "weak-b", { weight: 0.9899 }),
      link("causal-a", "causal-b", { linkType: "causal", weight: 1 }),
      link("fact", "observation", { toFactType: "observation", weight: 1 }),
    ]);

    expect(clusters).toEqual([]);
  });

  it("uses the configured threshold and a deterministic id tie-break", () => {
    const sameTime = "2026-07-20T02:00:00.000Z";
    const clusters = clusterDuplicateLinks([
      link("b", "a", {
        weight: 0.995,
        fromCreatedAt: sameTime,
        toCreatedAt: sameTime,
      }),
    ], 0.995);

    expect(clusters).toEqual([{ canonical: "a", dups: ["b"], size: 2 }]);
  });
});

describe("configuredBanks", () => {
  afterEach(() => {
    delete process.env["MEMORY_HYGIENE_BANK_ALLOWLIST"];
  });

  it("never includes the digital twin bank, even when the allowlist names it", () => {
    process.env["MEMORY_HYGIENE_BANK_ALLOWLIST"] =
      "xyne-digital-twin,xyne-xyne-spaces-architect";
    expect(configuredBanks()).toEqual(["xyne-xyne-spaces-architect"]);
  });

  it("returns the default allowlist when unset", () => {
    expect(configuredBanks()).toEqual(["xyne-xyne-spaces-architect"]);
  });
});

describe("collapseDuplicates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes ingest backpressure to the current bank", async () => {
    const query = vi.fn(async (sql: string, ..._params: unknown[]) => {
      if (sql.includes("async_operations")) return [{ count: 0n }];
      return [];
    });
    const db = { $queryRawUnsafe: query } as never;

    await collapseDuplicates(db, "https://hindsight.example", "bank-a", 100);

    expect(query.mock.calls[0]?.[0]).toContain("bank_id = $1");
    expect(query.mock.calls[0]?.[1]).toBe("bank-a");
  });

  it("aborts after 25 consecutive invalidation failures", async () => {
    const links = Array.from({ length: 30 }, (_, index) => link("canonical", `duplicate-${index}`, {
      fromCreatedAt: "2026-07-20T01:00:00.000Z",
      toCreatedAt: `2026-07-20T02:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("async_operations")) return [{ count: 0n }];
      return links;
    });
    const db = { $queryRawUnsafe: query } as never;
    const fetchMock = vi.fn(async () => {
      throw new Error("PATCH route unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collapseDuplicates(db, "https://hindsight.example", "bank-a", 2_000))
      .resolves.toEqual({ collapsed: 0, attempted: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(25);
  });
});
