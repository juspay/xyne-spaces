import { PrismaClient } from '@prisma/client'

export async function getUserGroupIds(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const mappings = await prisma.userGroupMapping.findMany({
    where: { userId },
    select: { userGroupId: true },
  })

  return mappings.map((m) => m.userGroupId)
}
