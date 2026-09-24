import { db } from '@/database/client';
import { RoleFrameworkBackfillController, type RoleFrameworkBackfillMode } from '@/controllers/roleFrameworkBackfillController';
import { asSystem } from './base';

const DEFAULT_ROLE_NAMES = ['MANAGER', 'TEAM_LEAD', 'MEMBER', 'PR_REVIEWER', 'QA'] as const;

type BackfillOptions = Parameters<typeof RoleFrameworkBackfillController.seedDefaultRoles>[0];

/**
 * Relocated from controllers/roleFrameworkBackfillController.ts's backfill dispatch. Every mode
 * seeds or repairs role-framework rows for each workspace in turn, so the sweep runs above any
 * single workspace's scope. The four backfill implementations themselves stay on the controller
 * class (each is 100+ lines) — only the runAsSystem entry point relocates.
 */
export function runRoleFrameworkBackfill(
  mode: RoleFrameworkBackfillMode,
  options: BackfillOptions,
  runId: string,
) {
  const reason = 'role-framework sweep repairs every workspace in turn, above any single workspace\'s scope';
  switch (mode) {
    case 'seedDefaultRoles':
      return asSystem(['Role'], reason, () => RoleFrameworkBackfillController.seedDefaultRoles(options, runId));
    case 'userGroupMappingsRoleId':
      return asSystem(['UserGroupMapping'], reason, () => RoleFrameworkBackfillController.backfillUserGroupMappingsRoleId(options, runId));
    case 'boardMetadata':
      return asSystem(['Board'], reason, () => RoleFrameworkBackfillController.backfillBoardMetadata(options, runId));
    case 'stageApproversApproverType':
      return asSystem(['StageApprovers'], reason, () => RoleFrameworkBackfillController.backfillStageApproversApproverType(options, runId));
  }
}

/**
 * Relocated from controllers/roleFrameworkBackfillController.ts's getBackfillStats. These
 * counts report the remaining work for a sweep that spans every workspace, so each read runs
 * above any single workspace's scope. All reads only — combined into one asSystem call rather
 * than one per query, which changes nothing about the results.
 */
export function getRoleFrameworkBackfillStats() {
  return asSystem(
    ['Workspace', 'Role', 'UserGroupMapping', 'Board', 'StageApprovers'],
    'stats report remaining work for a sweep that spans every workspace, above any single workspace\'s scope',
    async () => {
      // seedDefaultRoles stats
      const totalWorkspaces = await db.workspace.count();
      const totalRoles = await db.role.count();
      const rolesWithDefaultNames = await db.role.count({
        where: { name: { in: [...DEFAULT_ROLE_NAMES] } },
      });

      const workspacesWithAllDefaults = await db.workspace.findMany({
        select: {
          id: true,
          _count: {
            select: {
              roles: { where: { name: { in: [...DEFAULT_ROLE_NAMES] } } },
            },
          },
        },
      });
      const workspacesNeedingSeed = workspacesWithAllDefaults.filter(
        w => w._count.roles < DEFAULT_ROLE_NAMES.length,
      ).length;

      // userGroupMappingsRoleId stats
      const totalUserGroupMappings = await db.userGroupMapping.count();
      const userGroupMappingsNeedingRoleId = await db.userGroupMapping.count({
        where: { roleId: null, responsibility: { not: null } },
      });

      // boardMetadata stats — count boards where each key is missing/empty
      const totalBoards = await db.board.count();
      const boards = await db.board.findMany({
        select: { metadata: true },
      });
      let boardsNeedingAssignmentRoles = 0;
      let boardsNeedingTicketControlRoleIds = 0;
      let boardsNeedingBitbucketEventRoles = 0;
      for (const b of boards) {
        const md = (b.metadata as Record<string, unknown> | null) ?? {};
        const ar = Array.isArray(md.assignmentRoles) ? (md.assignmentRoles as unknown[]) : null;
        if (!ar || ar.length === 0) boardsNeedingAssignmentRoles += 1;
        const tc = Array.isArray(md.ticketControlRoleIds) ? (md.ticketControlRoleIds as unknown[]) : null;
        if (!tc || tc.length === 0) boardsNeedingTicketControlRoleIds += 1;
        if (!md.bitbucketEventRoles || typeof md.bitbucketEventRoles !== 'object') {
          boardsNeedingBitbucketEventRoles += 1;
        }
      }

      // stageApproversApproverType stats
      const totalStageApprovers = await db.stageApprovers.count();
      const stageApproversNeedingApproverType = await db.stageApprovers.count({
        where: { approverType: null },
      });

      return {
        seedDefaultRoles: {
          totalWorkspaces,
          totalRoles,
          rolesWithDefaultNames,
          workspacesNeedingSeed,
        },
        userGroupMappingsRoleId: {
          totalUserGroupMappings,
          userGroupMappingsNeedingRoleId,
        },
        boardMetadata: {
          totalBoards,
          boardsNeedingAssignmentRoles,
          boardsNeedingTicketControlRoleIds,
          boardsNeedingBitbucketEventRoles,
        },
        stageApproversApproverType: {
          totalStageApprovers,
          stageApproversNeedingApproverType,
        },
      };
    },
  );
}
