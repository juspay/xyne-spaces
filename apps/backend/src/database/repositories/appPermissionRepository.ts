import { BaseRepository } from './base';
import { currentWorkspaceId } from '@/database/tenant/context';
import { type Prisma, type AvailableAppPermission } from '@prisma/client';

// ─── Prisma transaction client type ──────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import { AppPermissionStatus, AppPermissionType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { DESK_SOURCE_PREFIXES, resolveAppDeskInstalledAppId } from '@/integrations/core/deskSources';
type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// ─── Typed row shapes from Prisma includes ────────────────────────────────────
type AppPermissionWithPerm = Prisma.AppPermissionGetPayload<{
  include: { permission: { select: { name: true; type: true } } };
}>;

type InstalledAppPermissionWithPerm = Prisma.InstalledAppPermissionGetPayload<{
  include: { permission: { select: { name: true; type: true } } };
}>;

type InstalledAppPermissionBase = Prisma.InstalledAppPermissionGetPayload<{
  select: { id: true; permissionId: true; status: true };
}>;

type AvailablePermissionIdNameType = Prisma.AvailableAppPermissionGetPayload<{
  select: { id: true; name: true; type: true };
}>;


function toScope(name: string, type: AppPermissionType): string {
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

  /** All registry entries, sorted by name then type. */
  async findAll() {
    return this.db.availableAppPermission.findMany({
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

  async getAppPermissions(appId: string): Promise<string[]> {
    const rows: AppPermissionWithPerm[] = await this.db.appPermission.findMany({
      where: { appId },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows.map((r) => toScope(r.permission.name, r.permission.type as AppPermissionType));
  }

  async setAppPermissions(appId: string, scopes: string[]): Promise<void> {
    const parsed = scopes.map(parseScope);
    await this.db.$transaction(async (tx: Tx) => {
      await tx.appPermission.deleteMany({ where: { appId } });
      if (parsed.length === 0) return;

      const permissions: AvailablePermissionIdNameType[] = await tx.availableAppPermission.findMany({
        where: { OR: parsed.map(({ name, type }) => ({ name, type })) },
        select: { id: true, name: true, type: true },
      });

      const foundScopes = new Set(permissions.map((p) => toScope(p.name, p.type as AppPermissionType)));
      const unknown = scopes.filter((s) => !foundScopes.has(s));
      if (unknown.length > 0) throw new Error(`Unknown permissions: ${unknown.join(', ')}`);

      const workspaceId = currentWorkspaceId();
      if (!workspaceId) throw new Error('workspaceId required: no tenant context');
      await tx.appPermission.createMany({
        data: permissions.map((p) => ({ appId, permissionId: p.id, workspaceId })),
        skipDuplicates: true,
      });
    });
  }


  async getGrantedPermissionsWithMeta(
    installedAppId: string,
  ): Promise<{ effectiveNames: string[]; hasPendingChanges: boolean }> {
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId },
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
  async hasPermissionsPendingReinstall(installedAppId: string): Promise<boolean> {
    const count = await this.db.installedAppPermission.count({
      where: {
        installedAppId,
        status: { in: [AppPermissionStatus.UNAPPROVED, AppPermissionStatus.PENDINGDELETE] },
      },
    });
    return count > 0;
  }

  async getInstalledPermissions(installedAppId: string): Promise<string[]> {
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows
      .filter((r) => r.status !== AppPermissionStatus.PENDINGDELETE)
      .map((r) => toScope(r.permission.name, r.permission.type as AppPermissionType));
  }

  /** All installed permissions with their current status (for status-badge UI). */
  async getInstalledPermissionsWithStatus(
    installedAppId: string,
  ): Promise<{ scope: string; status: AppPermissionStatus }[]> {
    const rows: InstalledAppPermissionWithPerm[] = await this.db.installedAppPermission.findMany({
      where: { installedAppId },
      include: { permission: { select: { name: true, type: true } } },
    });
    return rows.map((r) => ({ scope: toScope(r.permission.name, r.permission.type as AppPermissionType), status: r.status as AppPermissionStatus }));
  }


  async setInstalledPermissions(installedAppId: string, scopes: string[]): Promise<void> {
    const parsed = scopes.map(parseScope);
    await this.db.$transaction(async (tx: Tx) => {
      const permissions: AvailablePermissionIdNameType[] = await tx.availableAppPermission.findMany({
        where: { OR: parsed.map(({ name, type }) => ({ name, type })) },
        select: { id: true, name: true, type: true },
      });

      const foundScopes = new Set(permissions.map((p) => toScope(p.name, p.type as AppPermissionType)));
      const unknown = scopes.filter((s) => !foundScopes.has(s));
      if (unknown.length > 0) throw new Error(`Unknown permissions: ${unknown.join(', ')}`);

      const wantedIds = new Set(permissions.map((p) => p.id));

      const existing: InstalledAppPermissionBase[] = await tx.installedAppPermission.findMany({
        where: { installedAppId },
        select: { id: true, permissionId: true, status: true },
      });
      const existingMap = new Map<string, InstalledAppPermissionBase>(
        existing.map((r) => [r.permissionId, r]),
      );

      for (const [permissionId, row] of existingMap) {
        if (wantedIds.has(permissionId)) {
          // Restore PENDINGDELETE → APPROVED (admin re-added it)
          if (row.status === AppPermissionStatus.PENDINGDELETE) {
            await tx.installedAppPermission.update({
              where: { id: row.id },
              data: { status: AppPermissionStatus.APPROVED },
            });
          }
        } else {
          if (row.status === AppPermissionStatus.UNAPPROVED) {
            // Never activated — drop immediately
            await tx.installedAppPermission.delete({ where: { id: row.id } });
          } else if (row.status === AppPermissionStatus.APPROVED) {
            // Still active, mark for removal on next reinstall
            await tx.installedAppPermission.update({
              where: { id: row.id },
              data: { status: AppPermissionStatus.PENDINGDELETE },
            });
          }
        }
      }

      // Insert brand-new entries
      const toInsert = permissions.filter((p) => !existingMap.has(p.id));
      if (toInsert.length > 0) {
        const workspaceId = currentWorkspaceId();
        if (!workspaceId) throw new Error('workspaceId required: no tenant context');
        await tx.installedAppPermission.createMany({
          data: toInsert.map((p) => ({
            installedAppId,
            permissionId: p.id,
            workspaceId,
            status: AppPermissionStatus.UNAPPROVED,
          })),
          skipDuplicates: true,
        });
      }
    });
  }


  /**
   * Activate an install's pending permission edits, honoring the admin's selection.
   * Unlike syncFromAppApproved (which resets the install to the app template), this promotes
   * exactly what the admin edited on the Installed screen: UNAPPROVED → APPROVED (newly granted)
   * and hard-deletes PENDINGDELETE rows (revoked). Already-APPROVED rows are left untouched.
   */
  async activateInstalledPermissions(installedAppId: string): Promise<void> {
    await this.db.$transaction(async (tx: Tx) => {
      await tx.installedAppPermission.deleteMany({
        where: { installedAppId, status: AppPermissionStatus.PENDINGDELETE },
      });
      await tx.installedAppPermission.updateMany({
        where: { installedAppId, status: AppPermissionStatus.UNAPPROVED },
        data: { status: AppPermissionStatus.APPROVED },
      });
    });
    await this.deactivateAppDeskSourcesIfDeskWriteLost(installedAppId);
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
    await this.db.$transaction(async (tx: Tx) => {
      const grants = await tx.appPermission.findMany({
        where: { appId },
        select: { permissionId: true },
      });
      const wantedIds = grants.map((g) => g.permissionId);
      const wantedSet = new Set(wantedIds);

      const existing = await tx.installedAppPermission.findMany({
        where: { installedAppId },
        select: { id: true, permissionId: true },
      });
      const existingSet = new Set(existing.map((e) => e.permissionId));

      // Remove install permissions the template no longer has.
      const removeIds = existing.filter((e) => !wantedSet.has(e.permissionId)).map((e) => e.id);
      if (removeIds.length > 0) {
        await tx.installedAppPermission.deleteMany({ where: { id: { in: removeIds } } });
      }

      // Add template permissions missing from the install, as APPROVED.
      const toAdd = wantedIds.filter((id) => !existingSet.has(id));
      if (toAdd.length > 0) {
        const workspaceId = currentWorkspaceId();
        if (!workspaceId) throw new Error('workspaceId required: no tenant context');
        await tx.installedAppPermission.createMany({
          data: toAdd.map((permissionId) => ({
            installedAppId,
            permissionId,
            workspaceId,
            status: AppPermissionStatus.APPROVED,
          })),
          skipDuplicates: true,
        });
      }

      // Approve everything that remains from the template (clears any UNAPPROVED/PENDINGDELETE).
      if (wantedIds.length > 0) {
        await tx.installedAppPermission.updateMany({
          where: { installedAppId, permissionId: { in: wantedIds } },
          data: { status: AppPermissionStatus.APPROVED },
        });
      }
    });
    await this.deactivateAppDeskSourcesIfDeskWriteLost(installedAppId);
  }

  /**
   * When an install loses its effective desk:WRITE grant, its app-desk channel
   * bindings (ExternalSource rows keyed by externalIdentifier=installedAppId) go
   * inactive. Revocation alone blocks inbound (requirePermission re-reads grants
   * per call); this additionally flips the management-UI state to disconnected.
   */
  private async deactivateAppDeskSourcesIfDeskWriteLost(installedAppId: string): Promise<void> {
    const deskWrite = await this.db.installedAppPermission.findFirst({
      where: {
        installedAppId,
        status: { in: [AppPermissionStatus.APPROVED, AppPermissionStatus.PENDINGDELETE] },
        permission: { name: 'desk', type: AppPermissionType.WRITE },
      },
      select: { id: true },
    });
    if (deskWrite) return;

    // Pre-migration rows carry a null externalIdentifier and encode the install id in
    // their name, so filtering on the column alone would leave exactly those bindings
    // active after the grant is gone. Reach them by name prefix rather than scanning
    // every workspace's app-desk sources on each grant change — the resolver below is
    // what actually decides, this only bounds what we load.
    const candidates = await this.db.externalSource.findMany({
      where: {
        sourceType: 'app-desk',
        isActive: true,
        OR: [
          { externalIdentifier: installedAppId },
          {
            externalIdentifier: null,
            name: { startsWith: `${DESK_SOURCE_PREFIXES.APP}${installedAppId}` },
          },
        ],
      },
      select: { id: true, name: true, externalIdentifier: true },
    });
    const staleIds = candidates
      .filter(s => resolveAppDeskInstalledAppId(s) === installedAppId)
      .map(s => s.id);
    if (staleIds.length === 0) return;

    const { count } = await this.db.externalSource.updateMany({
      where: { id: { in: staleIds } },
      data: { isActive: false },
    });
    if (count > 0) {
      logger.info(`[AppPermissions] desk:write revoked for install ${installedAppId} — deactivated ${count} app-desk source(s)`);
    }
  }
}

