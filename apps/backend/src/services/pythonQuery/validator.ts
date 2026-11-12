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

const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT'])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A where clause is fields (and AND/OR/NOT around more where clauses). Each
 * field takes a value or an object of ALLOWED_OPERATORS (`not` may wrap more
 * operators). Nothing else nests: relation filters (`some`, `every`, `is`, or a
 * related model's fields) are rejected, because access checks and scopes only
 * cover the queried model, so a relation filter would read another model's data.
 */
function validateWhereOperators(where: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_KEYS.has(key)) {
      const items = Array.isArray(value) ? value : [value]
      for (const item of items) {
        if (!isPlainObject(item)) {
          return { valid: false, error: `"${key}" must contain where clauses` }
        }
        const result = validateWhereOperators(item)
        if (!result.valid) return result
      }
      continue
    }
    const result = validateFieldCondition(key, value)
    if (!result.valid) return result
  }

  return { valid: true }
}

function validateFieldCondition(field: string, condition: unknown): ValidationResult {
  if (!isPlainObject(condition)) return { valid: true } // equality: a value or a list
  for (const [rawOperator, operand] of Object.entries(condition)) {
    // translator.ts renames these Python-safe spellings
    const operator = rawOperator === 'in_' ? 'in' : rawOperator === 'not_' ? 'not' : rawOperator
    if (!ALLOWED_OPERATORS.has(operator)) {
      return {
        valid: false,
        error: `Invalid operator "${rawOperator}" on field "${field}" (relation filters are not supported)`,
      }
    }
    if (isPlainObject(operand)) {
      if (operator !== 'not') {
        return { valid: false, error: `Operator "${operator}" on field "${field}" takes a value, not an object` }
      }
      const result = validateFieldCondition(field, operand)
      if (!result.valid) return result
    }
  }
  return { valid: true }
}
