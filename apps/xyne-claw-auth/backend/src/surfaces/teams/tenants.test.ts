/**
 * Tenant → org binding against a fake database: one tenant, one org, and an
 * audit row for every change. Ids are invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; tenantId: string; orgId: string; boundByUserId: string; createdAt: Date };
const rows = new Map<string, Row>();
const identityDeletes: Array<Record<string, unknown>> = [];

vi.mock("../../db.js", () => ({
  prisma: {
    teamsTenantBinding: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId: string } }) => rows.get(where.tenantId) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        const row = { id: `b-${rows.size + 1}`, createdAt: new Date(0), ...data };
        rows.set(data.tenantId, row);
        return row;
      }),
      deleteMany: vi.fn(({ where }: { where: { tenantId: string; orgId: string } }) => {
        const row = rows.get(where.tenantId);
        if (row && row.orgId === where.orgId) {
          rows.delete(where.tenantId);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    userSurfaceIdentity: {
      deleteMany: vi.fn((args: Record<string, unknown>) => {
        identityDeletes.push(args);
        return { count: 2 };
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

const writeAuditLog = vi.fn(async (_entry: Record<string, unknown>) => undefined);
vi.mock("../../lib/audit.js", () => ({ writeAuditLog }));

const { bindTenant, orgForTenant, unbindTenant } = await import("./tenants.js");

const TENANT = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  rows.clear();
  identityDeletes.length = 0;
  vi.clearAllMocks();
});

describe("tenant binding", () => {
  it("binds a tenant to one org, idempotently, and audits the first bind only", async () => {
    expect(await orgForTenant(TENANT)).toBeNull();
    const first = await bindTenant({ tenantId: TENANT.toUpperCase(), orgId: "org-1", userId: "admin-1" });
    expect(first).toMatchObject({ ok: true, created: true, binding: { tenantId: TENANT, orgId: "org-1" } });
    expect(await orgForTenant(TENANT)).toBe("org-1");
    expect(await bindTenant({ tenantId: TENANT, orgId: "org-1", userId: "admin-1" })).toMatchObject({ ok: true, created: false });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0]?.[0]).toMatchObject({ actorUserId: "admin-1", eventType: "TEAMS_TENANT_BOUND", targetId: TENANT });
  });

  it("refuses to bind a tenant another org already holds", async () => {
    await bindTenant({ tenantId: TENANT, orgId: "org-1", userId: "admin-1" });
    expect(await bindTenant({ tenantId: TENANT, orgId: "org-2", userId: "admin-2" })).toEqual({ ok: false, reason: "bound_elsewhere" });
    expect(await orgForTenant(TENANT)).toBe("org-1");
  });

  it("unbinds only within the caller's org, dropping that tenant's Teams links, and audits it", async () => {
    await bindTenant({ tenantId: TENANT, orgId: "org-1", userId: "admin-1" });
    writeAuditLog.mockClear();

    expect((await unbindTenant({ tenantId: TENANT, orgId: "org-2", userId: "admin-2" })).removed).toBe(false);
    expect(await orgForTenant(TENANT)).toBe("org-1");

    expect(await unbindTenant({ tenantId: TENANT, orgId: "org-1", userId: "admin-1" })).toEqual({ removed: true, unlinked: 2 });
    expect(await orgForTenant(TENANT)).toBeNull();
    expect(identityDeletes.at(-1)).toEqual({
      where: { surfaceId: "teams", orgId: "org-1", surfaceUserId: { startsWith: `${TENANT}:` } },
    });
    expect(writeAuditLog.mock.calls.at(-1)?.[0]).toMatchObject({
      actorUserId: "admin-1",
      eventType: "TEAMS_TENANT_UNBOUND",
      targetId: TENANT,
      metadata: { orgId: "org-1", unlinkedIdentities: 2 },
    });
  });
});
