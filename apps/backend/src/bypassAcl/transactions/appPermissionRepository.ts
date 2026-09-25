import { transaction } from '../base';
import { AppPermissionRepository, Tx, AvailablePermissionIdNameType, toScope, InstalledAppPermissionBase } from '@/database/repositories/appPermissionRepository';
import { currentWorkspaceId } from '@/database/tenant/context';
import { AppPermissionStatus, AppPermissionType } from '@xyne/shared';


export function setAppPermissionsTx(self: AppPermissionRepository, appId: string, parsed: { name: string; type: AppPermissionType; }[], scopes: string[]) {
  return transaction(['AppPermission', 'AvailableAppPermission'], 'setAppPermissions: app permission wipe and recreate from the permission catalog must commit atomically; tx is not ACL-wrapped', self.db, async (tx: Tx) => {
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
export function setInstalledPermissionsTx(self: AppPermissionRepository, parsed: { name: string; type: AppPermissionType; }[], scopes: string[], installedAppId: string) {
  return transaction(['AvailableAppPermission', 'InstalledAppPermission'], 'setInstalledPermissions: installed permission diff, restore and insert must commit atomically; tx is not ACL-wrapped', self.db, async (tx: Tx) => {
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
export function activateInstalledPermissionsTx(self: AppPermissionRepository, installedAppId: string) {
  return transaction(['InstalledAppPermission'], 'activateInstalledPermissions: pending-delete removal and unapproved approval must commit atomically; tx is not ACL-wrapped', self.db, async (tx: Tx) => {
    await tx.installedAppPermission.deleteMany({
      where: { installedAppId, status: AppPermissionStatus.PENDINGDELETE },
    });
    await tx.installedAppPermission.updateMany({
      where: { installedAppId, status: AppPermissionStatus.UNAPPROVED },
      data: { status: AppPermissionStatus.APPROVED },
    });
  });
}
export function syncFromAppApprovedTx(self: AppPermissionRepository, appId: string, installedAppId: string) {
  return transaction(['AppPermission', 'InstalledAppPermission'], 'syncFromAppApproved: installed permission sync from approved template grants must commit atomically; tx is not ACL-wrapped', self.db, async (tx: Tx) => {
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
}
