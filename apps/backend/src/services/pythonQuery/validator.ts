import { z } from 'zod'

// Allowlisted models that can be queried
export const ALLOWED_MODELS = new Set([
  'ticket',
  'subTicket',
  'user',
  'userProfile',
  'project',
  'board',
  'stage',
  'channel',
  'channelParticipant',
  'conversation',
  'conversationParticipant',
  'message',
  'workflow',
  'workflowExecution',
  'workflowStep',
  'agent',
  'agentStep',
  'notification',
  'call',
  'canvas',
  'collectionItem',
  'organization',
  'form',
  'formEntityValues',
  'formFields',
  'activity',
  'userActivityEvent',
  'email',
  'messageAttachment',
  'draftMessage',
  'scheduledMessage',
  'emailDraft',
  'callParticipant',
  'bookmark',
  'savedUserConfiguration',
  'savedUserConfigurationValue'
])

// Allowed operators for where conditions
const ALLOWED_OPERATORS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode',
])

// Maximum query limits
export const MAX_TAKE = 1000
export const MAX_WHERE_DEPTH = 5

// Zod schema for query AST validation
const SortOrderSchema = z.enum(['asc', 'desc'])

const OrderBySchema = z.record(z.string(), SortOrderSchema)

const WhereConditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number()])),
    z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number()])),
        WhereConditionSchema,
      ]),
    ),
  ]),
)

const WhereInputSchema = z.record(z.string(), WhereConditionSchema).optional()

export const QueryASTSchema = z.object({
  model: z.string(),
  operation: z.enum(['findMany', 'count']).default('findMany'),
  where: WhereInputSchema,
  orderBy: z.array(OrderBySchema).optional(),
  take: z.number().int().positive().max(MAX_TAKE).optional(),
  skip: z.number().int().nonnegative().optional(),
})

export type QueryAST = z.infer<typeof QueryASTSchema>

export interface ValidationResult {
  valid: boolean
  error?: string
  ast?: QueryAST
}

/**
 * Validate the query AST
 */
export function validateQueryAST(input: unknown): ValidationResult {
  // Parse with Zod
  const parseResult = QueryASTSchema.safeParse(input)

  if (!parseResult.success) {
    return {
      valid: false,
      error: `Invalid query format: ${parseResult.error.message}`,
    }
  }

  const ast = parseResult.data

  // Check model is allowed
  if (!ALLOWED_MODELS.has(ast.model)) {
    return {
      valid: false,
      error: `Model "${ast.model}" is not allowed for querying`,
    }
  }

  // Validate where depth
  if (ast.where) {
    const depthResult = validateWhereDepth(ast.where, 0)
    if (!depthResult.valid) {
      return depthResult
    }
  }

  // Validate operators in where clause
  if (ast.where) {
    const operatorResult = validateWhereOperators(ast.where)
    if (!operatorResult.valid) {
      return operatorResult
    }
  }

  return { valid: true, ast }
}

/**
 * Check that where clause doesn't exceed max depth
 */
function validateWhereDepth(where: Record<string, unknown>, depth: number): ValidationResult {
  if (depth > MAX_WHERE_DEPTH) {
    return {
      valid: false,
      error: `Where clause exceeds maximum depth of ${MAX_WHERE_DEPTH}`,
    }
  }

  for (const value of Object.values(where)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const result = validateWhereDepth(value as Record<string, unknown>, depth + 1)
      if (!result.valid) {
        return result
      }
    }
  }

  return { valid: true }
}

function validateWhereOperators(where: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(where)) {
    // Skip logical operators
    if (['AND', 'OR', 'NOT'].includes(key)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            const result = validateWhereOperators(item as Record<string, unknown>)
            if (!result.valid) {
              return result
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        const result = validateWhereOperators(value as Record<string, unknown>)
        if (!result.valid) {
          return result
        }
      }
      continue
    }

    // Check nested operators
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const operator of Object.keys(value as Record<string, unknown>)) {
        // Skip if it looks like a field name (could be nested relation)
        if (!ALLOWED_OPERATORS.has(operator) && !operator.match(/^[a-z][a-zA-Z0-9]*$/)) {
          return {
            valid: false,
            error: `Invalid operator "${operator}" in where clause`,
          }
        }
      }

      // Recursively validate nested objects
      const result = validateWhereOperators(value as Record<string, unknown>)
      if (!result.valid) {
        return result
      }
    }
  }

  return { valid: true }
}
