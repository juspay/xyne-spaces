import { Prisma } from "@prisma/client";

/**
 * In-memory stand-in for prisma.sandboxRepoConfig, for unit tests only. It understands what
 * sandboxRepoConfigRepository sends and nothing more: equality, null, `in` and NOT filters, ordering by
 * key, select, and an array $transaction that undoes everything when one step fails. Like Prisma, a
 * query does nothing until it is awaited or handed to $transaction.
 */
export interface FakeSandboxRepoConfigRow {
  id: string;
  key: string;
  config: unknown;
  template: string;
  repoUrl: string | null;
  auxRepos: unknown;
  enabled: boolean;
  workspaceId: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Fields = Record<string, unknown>;
type Args = { where?: Fields; data?: Fields | Fields[]; select?: Record<string, boolean>; create?: Fields; update?: Fields; skipDuplicates?: boolean };
type Query<T> = PromiseLike<T> & { run: () => T };

const JSON_FIELDS = new Set(["config", "auxRepos"]);

function known(code: "P2002" | "P2025", message: string): Error {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "fake" });
}

function matches(where: Fields | undefined, row: Fields): boolean {
  return Object.entries(where ?? {}).every(([field, condition]) => {
    if (field === "NOT") return !matches(condition as Fields, row);
    if (condition !== null && typeof condition === "object" && "in" in condition) {
      return (condition as { in: unknown[] }).in.includes(row[field]);
    }
    return row[field] === condition;
  });
}

function stored(field: string, value: unknown): unknown {
  if (!JSON_FIELDS.has(field)) return value;
  // jsonb keeps no undefined and no object identity; Prisma.DbNull is SQL NULL.
  return value === Prisma.DbNull || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function pick(row: FakeSandboxRepoConfigRow, select: Record<string, boolean> | undefined): Fields {
  const copy = structuredClone(row) as unknown as Fields;
  if (!select) return copy;
  return Object.fromEntries(Object.keys(select).filter((field) => select[field]).map((field) => [field, copy[field]]));
}

export function createFakeSandboxRepoConfigDb() {
  let rows: FakeSandboxRepoConfigRow[] = [];
  let nextId = 1;
  let clock = Date.UTC(2026, 0, 1);
  /** Statements that changed a row, so a test can prove a run wrote nothing. */
  let writes = 0;

  const now = (): Date => new Date((clock += 1000));
  const query = <T>(run: () => T): Query<T> => ({
    run,
    then: (onFulfilled, onRejected) => Promise.resolve().then(run).then(onFulfilled, onRejected),
  });
  const hits = (where: Fields | undefined) => rows.filter((row) => matches(where, row as unknown as Fields));
  const byKey = (found: FakeSandboxRepoConfigRow[]) => [...found].sort((a, b) => a.key.localeCompare(b.key));

  function insert(data: Fields): FakeSandboxRepoConfigRow {
    if (rows.some((row) => row.key === data["key"])) throw known("P2002", "Unique constraint failed on the fields: (`key`)");
    if (typeof data["template"] !== "string") throw new Error('null value in column "template" violates not-null constraint');
    const at = now();
    const row = {
      id: `row-${nextId++}`,
      repoUrl: null,
      auxRepos: null,
      enabled: true,
      workspaceId: null,
      createdByUserId: null,
      updatedByUserId: null,
      createdAt: at,
      updatedAt: at,
      ...Object.fromEntries(Object.entries(data).map(([field, value]) => [field, stored(field, value)])),
    } as FakeSandboxRepoConfigRow;
    rows.push(row);
    writes += 1;
    return row;
  }

  function change(row: FakeSandboxRepoConfigRow, data: Fields): FakeSandboxRepoConfigRow {
    Object.assign(row, { updatedAt: now() }, Object.fromEntries(Object.entries(data).map(([f, v]) => [f, stored(f, v)])));
    writes += 1;
    return row;
  }

  const sandboxRepoConfig = {
    findMany: (args: Args = {}) => query(() => byKey(hits(args.where)).map((row) => pick(row, args.select))),
    findFirst: (args: Args = {}) =>
      query(() => {
        const [row] = byKey(hits(args.where));
        return row ? pick(row, args.select) : null;
      }),
    create: (args: Args) => query(() => pick(insert(args.data as Fields), args.select)),
    createManyAndReturn: (args: Args) =>
      query(() =>
        (args.data as Fields[])
          .filter((data) => !(args.skipDuplicates && rows.some((row) => row.key === data["key"])))
          .map((data) => pick(insert(data), args.select)),
      ),
    upsert: (args: Args) =>
      query(() => {
        const [row] = hits(args.where);
        return pick(row ? change(row, args.update as Fields) : insert(args.create as Fields), args.select);
      }),
    update: (args: Args) =>
      query(() => {
        const [row] = hits(args.where);
        if (!row) throw known("P2025", "No record was found for an update.");
        return pick(change(row, args.data as Fields), args.select);
      }),
    updateMany: (args: Args) => query(() => ({ count: hits(args.where).map((row) => change(row, args.data as Fields)).length })),
    updateManyAndReturn: (args: Args) =>
      query(() => hits(args.where).map((row) => pick(change(row, args.data as Fields), args.select))),
    delete: (args: Args) =>
      query(() => {
        const [row] = hits(args.where);
        if (!row) throw known("P2025", "No record was found for a delete.");
        rows = rows.filter((other) => other !== row);
        writes += 1;
        return pick(row, args.select);
      }),
  };

  return {
    prisma: {
      sandboxRepoConfig,
      $transaction: async (queries: Array<Query<unknown>>) => {
        const before = structuredClone(rows);
        try {
          return queries.map((each) => each.run());
        } catch (err) {
          rows = before;
          throw err;
        }
      },
    },
    /** Every row with every column, by key: what SELECT * would show. */
    rows: (): FakeSandboxRepoConfigRow[] => byKey(structuredClone(rows)),
    row: (key: string): FakeSandboxRepoConfigRow | undefined => structuredClone(rows.find((row) => row.key === key)),
    writes: (): number => writes,
    reset: (): void => {
      rows = [];
      nextId = 1;
      writes = 0;
    },
  };
}

/** One shared instance: a test mocks ../db.js with its `prisma` and inspects the same rows. */
export const fakeSandboxRepoConfigDb = createFakeSandboxRepoConfigDb();
