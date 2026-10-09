import type { PrismaClient } from '@prisma/client';
import {
  AccessType,
  ChannelRole,
  type SandboxProfileConfig,
  type SdlcSandboxProfile,
  type SdlcSandboxProfileList,
} from '@xyne/shared';
import { SDLC_MEMBERSHIP_RELATION } from '@xyne/shared/sdlc';
import { repositories } from '@/database/repositories/index';
import { AppError } from '@/middleware/errorHandler';
import {
  isClawAdminUser,
  listClawSandboxProfiles,
  resetClawSandboxProfile,
  saveClawSandboxProfile,
  setClawSandboxProfileEnabled,
  type ClawSandboxProfile,
} from '@/services/clawSandboxProfilesService';
import { canonicalizeRepositoryUrl } from './canonicalizeRepositoryUrl';
import type { SdlcActor } from './types';

export interface SandboxProfileRoles {
  clawAdmin: boolean;
  sdlcAdmin: boolean;
  /** Canonical URLs of repos in hubs the actor administers. */
  adminRepoUrls: Set<string>;
}

export function repoUrlKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return canonicalizeRepositoryUrl(url).canonicalUrl;
  } catch {
    return null;
  }
}

/**
 * Claw admins edit anything. Built-ins stay theirs. Otherwise the profile must be this workspace's
 * (claw-auth only returns those), and the actor an SDLC admin, or its creator while still admin of a
 * hub that has its repo.
 */
export function canEditProfile(
  roles: SandboxProfileRoles,
  actor: SdlcActor,
  profile: ClawSandboxProfile
): boolean {
  if (roles.clawAdmin) return true;
  if (profile.builtIn || profile.workspaceId !== actor.workspaceId) return false;
  if (roles.sdlcAdmin) return true;
  const repo = repoUrlKey(profile.config.repoUrl);
  return profile.createdByUserId === actor.userId && repo !== null && roles.adminRepoUrls.has(repo);
}

async function hasSdlcAdmin(userId: string): Promise<boolean> {
  const resource = await repositories.resources.findByName('SDLC');
  return (
    !!resource &&
    (await repositories.resourceAccess.hasAccess(userId, resource.id, AccessType.ADMIN))
  );
}

interface WorkspaceRepo {
  id: string;
  url: string;
  canonicalUrl: string | null;
}

async function loadRoles(db: PrismaClient, actor: SdlcActor) {
  const [clawAdmin, sdlcAdmin, repos, adminLinks] = await Promise.all([
    isClawAdminUser(actor.userId),
    hasSdlcAdmin(actor.userId),
    db.repo.findMany({
      where: { workspaceId: actor.workspaceId, projectId: { not: null } },
      select: { id: true, url: true, canonicalUrl: true },
    }),
    // Hub creators join as ADMIN participants, so the role covers them.
    db.sdlcEntityLink.findMany({
      where: {
        workspaceId: actor.workspaceId,
        relationType: SDLC_MEMBERSHIP_RELATION,
        targetType: 'REPOSITORY',
        channel: { participants: { some: { userId: actor.userId, role: ChannelRole.ADMIN } } },
      },
      select: { targetId: true },
    }),
  ]);
  const adminRepoIds = new Set(adminLinks.map((link) => link.targetId));
  const adminRepoUrls = new Set(
    repos
      .filter((repo) => adminRepoIds.has(repo.id))
      .map((repo) => repoUrlKey(repo.canonicalUrl || repo.url))
      .filter((url): url is string => url !== null)
  );
  const roles: SandboxProfileRoles = { clawAdmin, sdlcAdmin, adminRepoUrls };
  return { roles, repos: repos as WorkspaceRepo[], adminRepoIds };
}

// Setup commands stay with editors, as the claw-auth raw config route did.
function overview(config: SandboxProfileConfig): SandboxProfileConfig {
  const {
    slug,
    name,
    description,
    repoUrl,
    defaultBranch,
    workDir,
    template,
    sessionTimeoutMs,
    idleTimeoutMs,
  } = config;
  return {
    slug,
    name,
    description,
    ...(repoUrl ? { repoUrl } : {}),
    defaultBranch,
    workDir,
    template,
    ...(sessionTimeoutMs ? { sessionTimeoutMs } : {}),
    ...(idleTimeoutMs ? { idleTimeoutMs } : {}),
    steps: [],
  };
}

export async function listSandboxProfiles(
  db: PrismaClient,
  actor: SdlcActor
): Promise<SdlcSandboxProfileList> {
  const [{ roles, repos, adminRepoIds }, profiles] = await Promise.all([
    loadRoles(db, actor),
    listClawSandboxProfiles(actor.workspaceId),
  ]);
  const rows: SdlcSandboxProfile[] = profiles.map((profile) => {
    const canEdit = canEditProfile(roles, actor, profile);
    return {
      key: profile.key,
      config: canEdit ? profile.config : overview(profile.config),
      enabled: profile.enabled,
      builtIn: profile.builtIn,
      overridden: profile.overridden,
      canEdit,
    };
  });
  const anyRepo = roles.clawAdmin || roles.sdlcAdmin;
  return {
    profiles: rows,
    canCreateRepoIds: repos
      .filter((repo) => anyRepo || adminRepoIds.has(repo.id))
      .map((repo) => repo.id),
  };
}

async function editableProfile(
  db: PrismaClient,
  actor: SdlcActor,
  key: string
): Promise<ClawSandboxProfile> {
  const [{ roles }, profiles] = await Promise.all([
    loadRoles(db, actor),
    listClawSandboxProfiles(actor.workspaceId),
  ]);
  const profile = profiles.find((candidate) => candidate.key === key);
  if (!profile) throw new AppError('Sandbox profile not found', 404);
  if (!canEditProfile(roles, actor, profile))
    throw new AppError('You cannot edit this sandbox profile', 403);
  return profile;
}

export async function createSandboxProfile(
  db: PrismaClient,
  actor: SdlcActor,
  input: { repoId: string; key: string; config: SandboxProfileConfig }
): Promise<void> {
  const { roles, repos, adminRepoIds } = await loadRoles(db, actor);
  const repo = repos.find((candidate) => candidate.id === input.repoId);
  if (!repo) throw new AppError('SDLC repository not found', 404);
  if (!roles.clawAdmin && !roles.sdlcAdmin && !adminRepoIds.has(repo.id)) {
    throw new AppError('Hub admin access to this repository is required', 403);
  }
  // The repo row decides the URL, so a profile can't be pointed at another hub's repo.
  await saveClawSandboxProfile(input.key, {
    config: { ...input.config, repoUrl: repo.url },
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    create: true,
  });
}

export async function updateSandboxProfile(
  db: PrismaClient,
  actor: SdlcActor,
  key: string,
  config: SandboxProfileConfig
): Promise<void> {
  const profile = await editableProfile(db, actor, key);
  await saveClawSandboxProfile(key, {
    // The stored repoUrl wins; undefined (a no-repo built-in) drops out of the JSON body.
    config: { ...config, repoUrl: profile.config.repoUrl },
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    create: false,
  });
}

export async function setSandboxProfileEnabled(
  db: PrismaClient,
  actor: SdlcActor,
  key: string,
  enabled: boolean
): Promise<void> {
  await editableProfile(db, actor, key);
  await setClawSandboxProfileEnabled(key, {
    enabled,
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
  });
}

/** Built-ins only (so claw admins only): back to the code version. */
export async function resetSandboxProfile(
  db: PrismaClient,
  actor: SdlcActor,
  key: string
): Promise<void> {
  const profile = await editableProfile(db, actor, key);
  if (!profile.builtIn) throw new AppError('Only a built-in sandbox profile can be reset', 400);
  await resetClawSandboxProfile(key, actor.userId);
}
