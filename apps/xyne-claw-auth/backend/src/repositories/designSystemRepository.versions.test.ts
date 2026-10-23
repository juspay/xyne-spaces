import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Version history (XYNE-66824). The promise is that a delivered design can be
 * re-rendered from the system it used, which only holds if every version from 1
 * to the current one is actually on record — so what is asserted here is that a
 * snapshot exists for v1 at creation, that each content edit adds exactly one
 * more under the number the row moved to, and that a rename adds none.
 *
 * The Prisma fake mirrors the one in `.fallback.test.ts`. It can show which
 * writes happen and under which version, but NOT that they are atomic: a fake
 * `$transaction` just runs the callback. Atomicity and the
 * `[designSystemId, version]` collision are Postgres behaviour and were checked
 * against a real database, not here.
 */

const state = vi.hoisted(() => ({
  systems: [] as Array<Record<string, any>>,
  versions: [] as Array<Record<string, any>>,
  transactions: 0,
}));

// Every read and write returns a COPY, the way Prisma hands back a fresh object
// per query. Handing out the stored row instead made `findFirst` alias whatever
// `update` then mutated, so code comparing before-and-after saw one object and
// reported no change — a bug this fake would have hidden rather than caught.
const copy = <T extends Record<string, any>>(row: T): T => ({ ...row });

vi.mock("../db.js", () => {
  const client = {
    designSystem: {
      findFirst: vi.fn(async (args: { where: { id: string; orgId: string } }) => {
        const row = state.systems.find(
          (s) => s["id"] === args.where.id && s["orgId"] === args.where.orgId,
        );
        return row ? copy(row) : null;
      }),
      create: vi.fn(async (args: { data: Record<string, any> }) => {
        const row = { id: `ds-${state.systems.length + 1}`, version: 1, assets: null, ...args.data };
        state.systems.push(row);
        return copy(row);
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, any> }) => {
        const row = state.systems.find((s) => s["id"] === args.where.id);
        if (!row) throw new Error("no such system");
        for (const [key, value] of Object.entries(args.data)) {
          // Mirrors Prisma's `{ increment: n }` so the version the snapshot is
          // written under is the one the update actually produced.
          if (value && typeof value === "object" && "increment" in value) {
            row[key] = (row[key] ?? 0) + (value as { increment: number }).increment;
          } else {
            row[key] = value;
          }
        }
        return copy(row);
      }),
    },
    designSystemVersion: {
      create: vi.fn(async (args: { data: Record<string, any> }) => {
        const row: Record<string, any> = {
          id: `dsv-${state.versions.length + 1}`,
          assets: null,
          ...args.data,
        };
        const clash = state.versions.find(
          (v) =>
            v["designSystemId"] === row["designSystemId"] && v["version"] === row["version"],
        );
        // The real unique index rejects this. Kept in the fake so a regression
        // that double-writes one version fails loudly instead of silently
        // duplicating history.
        if (clash) throw new Error("unique constraint: [designSystemId, version]");
        state.versions.push(row);
        return row;
      }),
      findMany: vi.fn(
        async (args: {
          where: { designSystemId: string; orgId: string };
          take?: number;
        }) => {
          const rows = state.versions
            .filter(
              (v) =>
                v["designSystemId"] === args.where.designSystemId &&
                v["orgId"] === args.where.orgId,
            )
            .sort((a, b) => b["version"] - a["version"]);
          return args.take === undefined ? rows : rows.slice(0, args.take);
        },
      ),
      findFirst: vi.fn(
        async (args: { where: { designSystemId: string; version: number; orgId: string } }) =>
          state.versions.find(
            (v) =>
              v["designSystemId"] === args.where.designSystemId &&
              v["version"] === args.where.version &&
              v["orgId"] === args.where.orgId,
          ) ?? null,
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      state.transactions += 1;
      return fn(client);
    }),
  };
  return { prisma: client };
});

import { designSystemRepository } from "./designSystemRepository.js";

const ORG = "org-1";

const versionsOf = (designSystemId: string) =>
  state.versions
    .filter((v) => v["designSystemId"] === designSystemId)
    .sort((a, b) => a["version"] - b["version"]);

describe("designSystemRepository version snapshots", () => {
  beforeEach(() => {
    state.systems = [];
    state.versions = [];
    state.transactions = 0;
    vi.clearAllMocks();
  });

  const create = () =>
    designSystemRepository.create(ORG, "user-author", {
      name: "Acme",
      designMd: "# Acme\n\n- Tone: direct\n",
      tokensCss: ":root{\n--brand-primary: #2563EB;\n}\n",
    });

  it("records v1 when the system is created", async () => {
    const created = await create();

    expect(created.version).toBe(1);
    expect(versionsOf(created.id)).toMatchObject([
      {
        version: 1,
        orgId: ORG,
        designMd: "# Acme\n\n- Tone: direct\n",
        tokensCss: ":root{\n--brand-primary: #2563EB;\n}\n",
        changeSummary: "Created",
        createdBy: "user-author",
      },
    ]);
  });

  it("writes the system and its first version in one transaction", async () => {
    await create();
    expect(state.transactions).toBe(1);
  });

  it("archives the new content under the version the row moved to", async () => {
    const created = await create();

    const updated = await designSystemRepository.update(created.id, ORG, {
      designMd: "# Acme\n\n- Tone: warm\n",
      updatedBy: "user-editor",
    });

    expect(updated?.version).toBe(2);
    // The snapshot holds what the system IS at v2, not what it was at v1. A
    // history whose newest row is the previous content cannot answer for the
    // version in use.
    expect(versionsOf(created.id)).toMatchObject([
      { version: 1, designMd: "# Acme\n\n- Tone: direct\n" },
      { version: 2, designMd: "# Acme\n\n- Tone: warm\n" },
    ]);
  });

  it("credits the editor, not the system's creator", async () => {
    const created = await create();
    await designSystemRepository.update(created.id, ORG, {
      tokensCss: ":root{\n--brand-primary: #1D4ED8;\n}\n",
      updatedBy: "user-editor",
    });

    expect(versionsOf(created.id)[1]).toMatchObject({ createdBy: "user-editor" });
  });

  it("derives a line-level summary when the caller supplies none", async () => {
    const created = await create();
    await designSystemRepository.update(created.id, ORG, {
      tokensCss: ":root{\n--brand-primary: #1D4ED8;\n}\n",
      designMd: "# Acme\n\n- Tone: direct\n- Avoid: synergy\n",
    });

    expect(versionsOf(created.id)[1]?.["changeSummary"]).toBe(
      "tokens.css +1/-1 lines, DESIGN.md +1 line",
    );
  });

  it("keeps a caller's own summary, which is how a re-import names its diff", async () => {
    const created = await create();
    await designSystemRepository.update(created.id, ORG, {
      tokensCss: ":root{\n--brand-primary: #1D4ED8;\n}\n",
      changeSummary: "1 token changed",
    });

    expect(versionsOf(created.id)[1]?.["changeSummary"]).toBe("1 token changed");
  });

  it("adds no version for a rename", async () => {
    const created = await create();

    const renamed = await designSystemRepository.update(created.id, ORG, { name: "Acme Ltd" });

    expect(renamed?.name).toBe("Acme Ltd");
    expect(renamed?.version).toBe(1);
    expect(versionsOf(created.id)).toHaveLength(1);
  });

  it("adds no version when an edit sets the same content back", async () => {
    // The PATCH body carries every field, so a save with nothing touched would
    // otherwise mint a version per click.
    const created = await create();

    await designSystemRepository.update(created.id, ORG, {
      designMd: "# Acme\n\n- Tone: direct\n",
      tokensCss: ":root{\n--brand-primary: #2563EB;\n}\n",
    });

    expect(versionsOf(created.id)).toHaveLength(1);
  });

  it("counts an assets-only edit as a version, and says so honestly", async () => {
    const created = await create();

    await designSystemRepository.update(created.id, ORG, { assets: { logo: "a.png" } });

    const latest = versionsOf(created.id)[1];
    expect(latest).toMatchObject({ version: 2 });
    expect(latest?.["changeSummary"]).toBe("No changes to DESIGN.md or tokens.css");
  });

  it("returns null and writes nothing for a system in another org", async () => {
    const created = await create();

    const updated = await designSystemRepository.update(created.id, "org-2", {
      designMd: "# Stolen",
    });

    expect(updated).toBeNull();
    expect(versionsOf(created.id)).toHaveLength(1);
  });
});

describe("designSystemRepository version reads", () => {
  beforeEach(async () => {
    state.systems = [];
    state.versions = [];
    vi.clearAllMocks();
  });

  const seeded = async () => {
    const created = await designSystemRepository.create(ORG, "user-author", {
      name: "Acme",
      designMd: "v1",
      tokensCss: "v1",
    });
    for (const n of [2, 3]) {
      await designSystemRepository.update(created.id, ORG, {
        designMd: `v${n}`,
        updatedBy: "user-editor",
      });
    }
    return created;
  };

  it("lists newest first", async () => {
    const created = await seeded();
    const versions = await designSystemRepository.listVersions(created.id, ORG);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("caps the page", async () => {
    const created = await seeded();
    const versions = await designSystemRepository.listVersions(created.id, ORG, 2);
    expect(versions.map((v) => v.version)).toEqual([3, 2]);
  });

  it("lists nothing for another org", async () => {
    const created = await seeded();
    expect(await designSystemRepository.listVersions(created.id, "org-2")).toEqual([]);
  });

  it("fetches an earlier version with the content it had", async () => {
    const created = await seeded();
    const v1 = await designSystemRepository.getVersion(created.id, 1, ORG);
    expect(v1).toMatchObject({ version: 1, designMd: "v1" });
  });

  it("fetches the current version too, so the history is total", async () => {
    // Snapshotting the OLD content on each edit would leave the live version
    // missing from here and 404 the version the system is actually on.
    const created = await seeded();
    const current = await designSystemRepository.getVersion(created.id, 3, ORG);
    expect(current).toMatchObject({ version: 3, designMd: "v3" });
  });

  it("returns null for a version that does not exist", async () => {
    const created = await seeded();
    expect(await designSystemRepository.getVersion(created.id, 99, ORG)).toBeNull();
  });

  it("returns null for a known id and version in another org", async () => {
    const created = await seeded();
    expect(await designSystemRepository.getVersion(created.id, 1, "org-2")).toBeNull();
  });
});
