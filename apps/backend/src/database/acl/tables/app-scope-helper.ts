import { Prisma, PrismaClient } from '@prisma/client'

/**
 * Apps are owned by an ORG but live in the row of the workspace that created them, so plain
 * workspace scope hides an org's own app from its sibling workspaces. Everything that reads an
 * app — or a row hanging off one — resolves the caller's org through here instead.
 *
 * A workspace never changes org, so the mapping is memoised for the process lifetime. The lookup
 * runs on the un-extended client handed to every ACL, so it cannot recurse back through the ACL.
 */
const orgIdByWorkspace = new Map<string, string | null>()

export async function resolveOrgId(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<string | null> {
  if (!workspaceId) return null
  const cached = orgIdByWorkspace.get(workspaceId)
  if (cached !== undefined) return cached

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { orgId: true },
  })
  const orgId = workspace?.orgId ?? null
  // Only a resolved mapping is worth keeping; a miss may just be a workspace not created yet.
  if (orgId) orgIdByWorkspace.set(workspaceId, orgId)
  return orgId
}

/**
 * READ visibility for an app: anything its owning org created, plus GLOBAL (marketplace) apps,
 * which install anywhere. Falls back to workspace scope when the org cannot be resolved so an
 * unresolved lookup narrows rather than widens.
 */
export async function appVisibilityWhere(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<Prisma.AppsWhereInput> {
  const orgId = await resolveOrgId(prisma, workspaceId)
  if (!orgId) return { workspaceId }
  return { OR: [{ orgId }, { scope: 'GLOBAL' }] }
}
