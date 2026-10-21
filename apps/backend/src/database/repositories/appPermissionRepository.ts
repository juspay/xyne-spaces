import { setAppPermissionsTx } from '@/bypassAcl/transactions/appPermissionRepository';
import { BaseRepository } from './base';
import { currentWorkspaceId } from '@/database/tenant/context';
import { type Prisma, type AvailableAppPermission } from '@prisma/client';

// ─── Prisma transaction client type ──────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import { AppPermissionStatus, AppPermissionType } from '@xyne/shared';
import { setInstalledPermissionsTx } from '@/bypassAcl/transactions/appPermissionRepository';
import { activateInstalledPermissionsTx } from '@/bypassAcl/transactions/appPermissionRepository';
import { syncFromAppApprovedTx } from '@/bypassAcl/transactions/appPermissionRepository';
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ─── Typed row shapes from Prisma includes ────────────────────────────────────
type AppPermissionWithPerm = Prisma.AppPermissionGetPayload<{
  include: { permission: { select: { name: true; type: true } } };
}>;

type InstalledAppPermissionWithPerm = Prisma.InstalledAppPermissionGetPayload<{
  include: { permission: { select: { name: true; type: true } } };
}>;

export type InstalledAppPermissionBase = Prisma.InstalledAppPermissionGetPayload<{
  select: { id: true; permissionId: true; status: true };
}>;

export type AvailablePermissionIdNameType = Prisma.AvailableAppPermissionGetPayload<{
  select: { id: true; name: true; type: true };
}>;


/**
 * The registry holds two kinds of rows, told apart by `type`:
 *  - 'api'   — API permissions (READ / WRITE / DELETE / START), checked by requirePermission.
 *  - 'event' — event subscriptions (SUBSCRIBE), which gate the outbound app events an install
 *              receives. No SUBSCRIBE rows at all means "every event" (legacy behaviour).
 * Every read/write below is scoped to one kind so the two modals never touch each other's rows.
 */
export type PermissionKind = 'api' | 'event';

export function permissionTypeWhere(kind: PermissionKind): Prisma.AvailableAppPermissionWhereInput {
  return kind === 'event'
    ? { type: AppPermissionType.SUBSCRIBE }
    : { type: { not: AppPermissionType.SUBSCRIBE } };
}

export function scopeKind(type: AppPermissionType): PermissionKind {
  return type === AppPermissionType.SUBSCRIBE ? 'event' : 'api';
}

export function toScope(name: string, type: AppPermissionType): string {
  return `${name}:${type.toLowerCase()}`;
}

function parseScope(scope: string): { name: string; type: AppPermissionType } {
  const colonIdx = scope.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`Invalid permission scope "${scope}" — expected "resource:action" e.g. "chat:write"`);
  }
  const name = scope.slice(0, colonIdx);
  const typeRaw = scope.slice(colonIdx + 1).toUpperCase();
  if (!(typeRaw in AppPermissionType)) {
    throw new Error(
      `Unknown action "${scope.slice(colonIdx + 1)}" in scope "${scope}". Valid: ${Object.values(AppPermissionType).map((v) => v.toLowerCase()).join(', ')}`,
    );
  }
  return { name, type: typeRaw as AppPermissionType };
}

/** Reject scopes of the other kind (e.g. an event scope saved through the API modal). */
function assertScopesOfKind(parsed: { type: AppPermissionType }[], scopes: string[], kind: PermissionKind): void {
  const wrong = scopes.filter((_, i) => scopeKind(parsed[i].type) !== kind);
  if (wrong.length > 0) throw new Error(`Unknown permissions: ${wrong.join(', ')}`);
}

export class AppPermissionRepository extends BaseRepository<
  AvailableAppPermission,
  Prisma.AvailableAppPermissionUncheckedCreateInput,
  Prisma.AvailableAppPermissionUpdateInput
> {
  constructor() {
    super('availableAppPermission');
  }


  async create(data: Prisma.AvailableAppPermissionUncheckedCreateInput) {
    return this.db.availableAppPermission.create({ data });
  }

  async findById(id: string) {
    return this.db.availableAppPermission.findUnique({ where: { id } });
  }

  async findMany(options?: {
    where?: Prisma.AvailableAppPermissionWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.AvailableAppPermissionOrderByWithRelationInput | Prisma.AvailableAppPermissionOrderByWithRelationInput[];
  }) {
    return this.db.availableAppPermission.findMany(options ?? {});
  }

  async update(id: string, data: Prisma.AvailableAppPermissionUpdateInput) {
    return this.db.availableAppPermission.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.availableAppPermission.delete({ where: { id } });
  }

  /** Look up a single registry entry by its scope string (e.g. "chat:write"). */
  async findByScope(scope: string) {
    const { name, type } = parseScope(scope);
    return this.db.availableAppPermission.findUnique({ where: { name_type: { name, type } } });
  }

  /** All registry entries of one kind, sorted by name then type. */
  async findAll(kind: PermissionKind = 'api') {
    return this.db.availableAppPermission.findMany({
      where: permissionTypeWhere(kind),
      orderBy: [{ name: 'asc' }, { type: 'asc' }],
    });
  }


  async upsertByScope(scope: string, description?: string) {
    const { name, type } = parseScope(scope);
    return this.db.availableAppPermission.upsert({
      where: { name_type: { name, type } },
      create: { name, type, description },
      update: {},
    });
  }

  async getAppPermissions(appId: string, kind: PermissionKind = 'api'): Promise<string[]> {
    const rows: AppPermissionWithPerm[] = await this.db.appPermission.findMany({
      where: { appId, permission: permissionTypeWhere(kind) },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows.map((r) => toScope(r.permission.name, r.permission.type as AppPermissionType));
  }

  async setAppPermissions(appId: string, scopes: string[], kind: PermissionKind = 'api'): Promise<void> {
    const parsed = scopes.map(parseScope);
    assertScopesOfKind(parsed, scopes, kind);
    await setAppPermissionsTx(this, appId, parsed, scopes, kind);
  }


  async getGrantedPermissionsWithMeta(
    installedAppId: string,
  ): Promise<{ effectiveNames: string[]; hasPendingChanges: boolean }> {
    // API permissions only: event subscriptions must not leak into the app's granted
    // scopes or mark its API permissions stale.
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId, permission: permissionTypeWhere('api') },
      include: { permission: { select: { name: true, type: true } } },
    });
    if (rows.length === 0) return { effectiveNames: [], hasPendingChanges: false };

    const effectiveNames = rows
      .filter((r) => r.status === AppPermissionStatus.APPROVED || r.status === AppPermissionStatus.PENDINGDELETE)
      .map((r) => toScope(r.permission.name, r.permission.type as AppPermissionType));

    const hasPendingChanges = rows.some(
      (r) => r.status === AppPermissionStatus.UNAPPROVED || r.status === AppPermissionStatus.PENDINGDELETE,
    );

    return { effectiveNames, hasPendingChanges };
  }

  /** True when any installed permission needs a reinstall to take effect. */
  async hasPermissionsPendingReinstall(installedAppId: string, kind: PermissionKind = 'api'): Promise<boolean> {
    const count = await this.db.installedAppPermission.count({
      where: {
        installedAppId,
        permission: permissionTypeWhere(kind),
        status: { in: [AppPermissionStatus.UNAPPROVED, AppPermissionStatus.PENDINGDELETE] },
      },
    });
    return count > 0;
  }

  async getInstalledPermissions(installedAppId: string, kind: PermissionKind = 'api'): Promise<string[]> {
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId, permission: permissionTypeWhere(kind) },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows
      .filter((r) => r.status !== AppPermissionStatus.PENDINGDELETE)
      .map((r) => toScope(r.permission.name, r.permission.type as AppPermissionType));
  }

  /** All installed permissions with their current status (for status-badge UI). */
  async getInstalledPermissionsWithStatus(
    installedAppId: string,
    kind: PermissionKind = 'api',
  ): Promise<{ scope: string; status: AppPermissionStatus }[]> {
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId, permission: permissionTypeWhere(kind) },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows.map((r) => ({ scope: toScope(r.permission.name, r.permission.type as AppPermissionType), status: r.status as AppPermissionStatus }));
  }


  async setInstalledPermissions(installedAppId: string, scopes: string[], kind: PermissionKind = 'api'): Promise<void> {
    const parsed = scopes.map(parseScope);
    assertScopesOfKind(parsed, scopes, kind);
    await setInstalledPermissionsTx(this, parsed, scopes, installedAppId, kind);
  }


  /**
   * Activate an install's pending permission edits, honoring the admin's selection.
   * Unlike syncFromAppApproved (which resets the install to the app template), this promotes
   * exactly what the admin edited on the Installed screen: UNAPPROVED → APPROVED (newly granted)
   * and hard-deletes PENDINGDELETE rows (revoked). Already-APPROVED rows are left untouched.
   */
  async activateInstalledPermissions(installedAppId: string, kind: PermissionKind = 'api'): Promise<void> {
    await activateInstalledPermissionsTx(this, installedAppId, kind);
  }


  async copyFromApp(appId: string, installedAppId: string): Promise<void> {
    const grants = await this.db.appPermission.findMany({
      where: { appId },
      select: { permissionId: true },
    });
    if (grants.length === 0) return;

    const workspaceId = currentWorkspaceId();
    if (!workspaceId) throw new Error('workspaceId required: no tenant context');
    await this.db.installedAppPermission.createMany({
      data: grants.map((g) => ({
        installedAppId,
        permissionId: g.permissionId,
        workspaceId,
        status: AppPermissionStatus.APPROVED,
      })),
      skipDuplicates: true,
    });
  }


  /**
   * Make an install's permissions exactly match the app's current template, all APPROVED.
   * Used on Update: the latest template permissions are granted directly (no pending step) —
   * adds new ones, removes ones the creator dropped, approves the rest.
   */
  async syncFromAppApproved(appId: string, installedAppId: string): Promise<void> {
    await syncFromAppApprovedTx(this, appId, installedAppId);
  }
}





