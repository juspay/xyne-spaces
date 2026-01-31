import { QueryAST } from './validator'

export interface PrismaFindManyArgs {
  where?: Record<string, unknown>
  orderBy?: Array<Record<string, 'asc' | 'desc'>>
  take?: number
  skip?: number
}

export interface PrismaCountArgs {
  where?: Record<string, unknown>
}

export interface TranslatedQuery {
  modelName: string
  operation: 'findMany' | 'count'
  args: PrismaFindManyArgs | PrismaCountArgs
}

function translateWhere(where: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(where)) {
    // Handle logical operators
    if (key === 'AND' || key === 'OR') {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'object' && item !== null ? translateWhere(item as Record<string, unknown>) : item,
        )
      }
      continue
    }

    if (key === 'NOT') {
      if (typeof value === 'object' && value !== null) {
        result[key] = translateWhere(value as Record<string, unknown>)
      }
      continue
    }

    // Use field name as-is (already matches Prisma schema)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = translateWhereValue(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }

  return result
}

function translateWhereValue(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [op, opValue] of Object.entries(value)) {
    // Only translate Python reserved keyword operators
    const prismaOp = op === 'in_' ? 'in' : op === 'not_' ? 'not' : op

    // Recursively translate nested objects
    if (typeof opValue === 'object' && opValue !== null && !Array.isArray(opValue)) {
      result[prismaOp] = translateWhereValue(opValue as Record<string, unknown>)
    } else {
      result[prismaOp] = opValue
    }
  }

  return result
}

export function translateQueryAST(ast: QueryAST): TranslatedQuery {
  const modelName = ast.model

  if (ast.operation === 'count') {
    const args: PrismaCountArgs = {}
    if (ast.where) {
      args.where = translateWhere(ast.where)
    }
    return { modelName, operation: 'count', args }
  }

  // findMany operation
  const args: PrismaFindManyArgs = {}

  if (ast.where) {
    args.where = translateWhere(ast.where)
  }

  // orderBy is already in Prisma format, use directly
  if (ast.orderBy && ast.orderBy.length > 0) {
    args.orderBy = ast.orderBy as Array<Record<string, 'asc' | 'desc'>>
  }

  if (ast.take !== undefined) {
    args.take = ast.take
  }

  if (ast.skip !== undefined) {
    args.skip = ast.skip
  }

  return { modelName, operation: 'findMany', args }
}
