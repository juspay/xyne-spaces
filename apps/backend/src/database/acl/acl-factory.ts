import { PrismaClient, Prisma } from '@prisma/client'
import { BaseQueryACL, ACLContext } from './base-acl'
import { POLICY } from './policy/policy-map'

/** Factory key ('draftMessage') → Prisma model name ('DraftMessage'), built once from the map. */
const MODEL_BY_KEY = new Map<string, Prisma.ModelName>(
  (Object.keys(POLICY) as Prisma.ModelName[]).map((m) => [m.charAt(0).toLowerCase() + m.slice(1), m]),
)

/**
 * Resolves a table's ACL. Every rule lives in the policy map (policy/policy-map.ts), which has one
 * entry per Prisma model; this is only the lookup.
 */
export class ACLFactory {
  static getACL(
    modelName: Uncapitalize<Prisma.ModelName>,
    ctx: ACLContext,
    prisma: PrismaClient,
  ): BaseQueryACL {
    const model = MODEL_BY_KEY.get(modelName)
    if (!model) {
      // Unreachable while POLICY is typed Record<Prisma.ModelName, …>; fail closed if it ever happens.
      throw new Error(`[acl] no policy for model "${modelName}"`)
    }
    return POLICY[model](ctx, prisma)
  }
}
