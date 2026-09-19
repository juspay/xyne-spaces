import { describe, expect, it, beforeEach, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import {
  buildBackfillBatchResponse,
  parseBackfillLimit,
  planBackfillPage,
} from "./backfill-pagination.js";

const K_GCM = Buffer.alloc(32, 7);
const K_CBC = Buffer.alloc(32, 9);

const prismaState = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    agent: {
      update: prismaState.update,
    },
  },
}));

function legacyCbcBlob(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", K_CBC, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

vi.mock("./spaces-db.js", () => ({
  getInstalledAppSigningSecret: vi.fn(async () =>
    legacyCbcBlob("signing-secret-plaintext"),
  ),
}));

vi.mock("../config.js", () => ({
  CONFIG: {
    encryptionKey: K_GCM,
    spacesEncryptionKey: K_CBC,
    spacesInternalUrl: "http://localhost:3001",
  },
}));

describe("parseBackfillLimit", () => {
  it("defaults to 100 when omitted", () => {
    expect(parseBackfillLimit(undefined)).toEqual({
      ok: true,
      limit: 100,
    });
  });

  it("rejects 0, negatives and non-numeric values", () => {
    for (const raw of ["0", "-1", "abc", "1.5"]) {
      const parsed = parseBackfillLimit(raw);
      expect(parsed.ok).toBe(false);
    }
  });

  it("rejects values above 500", () => {
    const parsed = parseBackfillLimit("501");
    expect(parsed).toEqual({
      ok: false,
      error: "limit must be between 1 and 500",
    });
  });

  it("accepts in-range values", () => {
    for (const raw of ["1", "100", "500"]) {
      const parsed = parseBackfillLimit(raw);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.limit).toBe(Number(raw));
      }
    }
  });
});

describe("planBackfillPage", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `agent-${String(i).padStart(4, "0")}`,
    }));

  it("returns the cursor only when another row exists", () => {
    const { page, hasMore, nextAfter } = planBackfillPage(
      rows(101),
      100,
    );
    expect(page).toHaveLength(100);
    expect(hasMore).toBe(true);
    expect(nextAfter).toBe("agent-0099");
  });

  it("does not emit a phantom cursor when the page is exactly full", () => {
    const { page, hasMore, nextAfter } = planBackfillPage(
      rows(100),
      100,
    );
    expect(page).toHaveLength(100);
    expect(hasMore).toBe(false);
    expect(nextAfter).toBeNull();
  });

  it("returns no cursor on a partial final page", () => {
    const { page, hasMore, nextAfter } = planBackfillPage(
      rows(3),
      100,
    );
    expect(page).toHaveLength(3);
    expect(hasMore).toBe(false);
    expect(nextAfter).toBeNull();
  });

  it("processes zero rows without a cursor", () => {
    const { page, hasMore, nextAfter } = planBackfillPage([], 100);
    expect(page).toHaveLength(0);
    expect(hasMore).toBe(false);
    expect(nextAfter).toBeNull();
  });
});

describe("buildBackfillBatchResponse", () => {
  const okRow = (n: number) => ({
    slug: `s${n}`,
    agentId: `id-${n}`,
    ok: true as const,
    action: "updated" as const,
  });
  const failRow = (n: number) => ({
    slug: `s${n}`,
    agentId: `id-${n}`,
    ok: false as const,
    reason: "read_failed" as const,
  });

  it("succeeds when every row succeeds", () => {
    const response = buildBackfillBatchResponse({
      dryRun: false,
      overwrite: true,
      slug: null,
      after: null,
      limit: 100,
      nextAfter: "id-9",
      results: Array.from({ length: 10 }, (_, i) => okRow(i)),
    });
    expect(response.success).toBe(true);
    expect(response.data.partialFailure).toBe(false);
    expect(response.data.ok).toBe(10);
    expect(response.data.failed).toBe(0);
  });

  it("flags partial failures without hiding successful rows", () => {
    const response = buildBackfillBatchResponse({
      dryRun: false,
      overwrite: false,
      slug: null,
      after: null,
      limit: 100,
      nextAfter: null,
      results: [
        ...Array.from({ length: 8 }, (_, i) => okRow(i)),
        failRow(8),
        failRow(9),
      ],
    });
    expect(response.success).toBe(false);
    expect(response.data.partialFailure).toBe(true);
    expect(response.data.ok).toBe(8);
    expect(response.data.failed).toBe(2);
    expect(response.data.results).toHaveLength(10);
    expect(response.data.results[0]?.ok).toBe(true);
    expect(response.data.results[9]?.ok).toBe(false);
  });

  it("succeeds on an empty batch", () => {
    const response = buildBackfillBatchResponse({
      dryRun: true,
      overwrite: true,
      slug: null,
      after: null,
      limit: 100,
      nextAfter: null,
      results: [],
    });
    expect(response.success).toBe(true);
    expect(response.data.partialFailure).toBe(false);
    expect(response.data.total).toBe(0);
  });
});

describe("backfillSigningSecretFromSpacesDbDetailed", () => {
  beforeEach(() => {
    prismaState.update.mockReset();
  });

  it("dry run validates cryptography without updating the agent", async () => {
    const { backfillSigningSecretFromSpacesDbDetailed } = await import(
      "./spaces-app-secret.js"
    );
    const result = await backfillSigningSecretFromSpacesDbDetailed({
      agentId: "agent-1",
      spacesAppId: "spaces-app-1",
      dryRun: true,
    });

    expect(result).toEqual({ ok: true, action: "validated" });
    expect(prismaState.update).not.toHaveBeenCalled();
  });

  it("write mode persists the re-encrypted secret", async () => {
    const { backfillSigningSecretFromSpacesDbDetailed } = await import(
      "./spaces-app-secret.js"
    );
    const result = await backfillSigningSecretFromSpacesDbDetailed({
      agentId: "agent-1",
      spacesAppId: "spaces-app-1",
      dryRun: false,
    });

    expect(result).toEqual({ ok: true, action: "updated" });
    expect(prismaState.update).toHaveBeenCalledTimes(1);
  });
});
