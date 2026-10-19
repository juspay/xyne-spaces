import { transaction } from '../base';
import { db } from '@/database/client';
import type { AuthSessionStatus } from '@/services/authSessionService';

export interface ReplaceActiveAuthSessionInput {
  orgMemberId: string;
  orgId: string;
  deviceKey: string;
  /** sha256 of the raw xs cookie value. */
  refreshToken: string;
  status: AuthSessionStatus;
  revokedStatus: AuthSessionStatus;
  /** Why the device's previous active session is being revoked. */
  revokeReason: string;
  platform: string;
  refreshTokenExpiry: Date;
  deviceInfo: string;
  /** Workspace the session lands in; stamped as the session's first access row. */
  workspaceId?: string;
}

/** Revoke the device's active auth session and create its replacement atomically. */
export function replaceActiveAuthSessionTx(input: ReplaceActiveAuthSessionInput) {
  return transaction(
    ['AuthSession', 'AuthSessionWorkspaceAccess'],
    'login: revoking the device\'s previous active auth session and creating the new one must commit atomically; tx is not ACL-wrapped',
    db,
    async tx => {
      const previous = await tx.authSession.findMany({
        where: { orgMemberId: input.orgMemberId, deviceKey: input.deviceKey, status: input.status },
        select: { id: true },
      });
      if (previous.length > 0) {
        const previousIds = previous.map(row => row.id);
        await tx.authSession.updateMany({
          where: { id: { in: previousIds } },
          data: { status: input.revokedStatus, revokedAt: new Date(), revokeReason: input.revokeReason },
        });
        // Workspace access rows follow their parent session's revocation.
        await tx.authSessionWorkspaceAccess.updateMany({
          where: { authSessionId: { in: previousIds }, status: input.status },
          data: { status: input.revokedStatus },
        });
      }
      return tx.authSession.create({
        data: {
          orgMemberId: input.orgMemberId,
          orgId: input.orgId,
          refreshToken: input.refreshToken,
          deviceKey: input.deviceKey,
          status: input.status,
          platform: input.platform,
          refreshTokenExpiry: input.refreshTokenExpiry,
          deviceInfo: input.deviceInfo,
          ...(input.workspaceId && {
            workspaceAccess: { create: { workspaceId: input.workspaceId, status: input.status } },
          }),
        },
      });
    },
  );
}

/** Record that an auth session entered a workspace. Idempotent; never reactivates a revoked row. */
export function recordWorkspaceAccessTx(authSessionId: string, workspaceId: string, status: AuthSessionStatus) {
  return transaction(
    ['AuthSessionWorkspaceAccess'],
    'login/switch: stamping the workspace an org-scoped auth session entered; table is unscoped and write-only',
    db,
    tx =>
      tx.authSessionWorkspaceAccess.upsert({
        where: { authSessionId_workspaceId: { authSessionId, workspaceId } },
        create: { authSessionId, workspaceId, status },
        update: {},
      }),
  );
}

export interface RevokeActiveAuthSessionsInput {
  /** sha256 of the xs cookie the client presented, if any. */
  refreshToken?: string;
  orgMemberId?: string;
  deviceKey?: string;
  activeStatus: AuthSessionStatus;
  revokedStatus: AuthSessionStatus;
  revokeReason: string;
}

/**
 * Revoke the device's active auth session(s) and their workspace access rows atomically.
 * Matches by presented xs hash and/or (orgMemberId, deviceKey). Returns the revoked count.
 */
export function revokeActiveAuthSessionsTx(input: RevokeActiveAuthSessionsInput) {
  const matchers = [
    ...(input.refreshToken ? [{ refreshToken: input.refreshToken }] : []),
    ...(input.orgMemberId && input.deviceKey ? [{ orgMemberId: input.orgMemberId, deviceKey: input.deviceKey }] : []),
  ];
  return transaction(
    ['AuthSession', 'AuthSessionWorkspaceAccess'],
    'logout: revoking the device\'s auth session and its workspace access rows must commit atomically; tx is not ACL-wrapped',
    db,
    async tx => {
      if (matchers.length === 0) return 0;
      const active = await tx.authSession.findMany({
        where: { status: input.activeStatus, OR: matchers },
        select: { id: true },
      });
      if (active.length === 0) return 0;
      const ids = active.map(row => row.id);
      await tx.authSession.updateMany({
        where: { id: { in: ids } },
        data: { status: input.revokedStatus, revokedAt: new Date(), revokeReason: input.revokeReason },
      });
      await tx.authSessionWorkspaceAccess.updateMany({
        where: { authSessionId: { in: ids }, status: input.activeStatus },
        data: { status: input.revokedStatus },
      });
      return ids.length;
    },
  );
}
