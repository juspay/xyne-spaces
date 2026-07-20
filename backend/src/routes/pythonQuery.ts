import { Router, Request, Response } from 'express'
import { readReplicaDb } from '@/database/client'
import { logger } from '@/utils/logger'
import { validateQueryAST, translateQueryAST, ACLFactory } from '@/services/pythonQuery'
const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now()

  try {
    if (!readReplicaDb) {
      res.status(503).json({ error: 'Read replica not available' })
      return
    }

    const userId = req.user?.id

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    // Validate the query AST
    const validationResult = validateQueryAST(req.body)

    if (!validationResult.valid || !validationResult.ast) {
      logger.warn('Invalid query AST received', {
        userId,
        error: validationResult.error,
        body: req.body,
      })
      res.status(400).json({ error: validationResult.error })
      return
    }

    const ast = validationResult.ast

    // Translate AST to Prisma query
    const translated = translateQueryAST(ast)

    // Apply ACLs
    const aclContext = { userId, workspaceId: req.user?.workspaceId }
    const acl = ACLFactory.getACL(translated.modelName, aclContext, readReplicaDb)
    const whereWithAcl = await acl.applyToWhere(translated.args.where as Record<string, unknown>)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (readReplicaDb as any)[translated.modelName]

    if (!model || typeof model !== 'object') {
      logger.error(`Model not found in Prisma client: ${translated.modelName}`)
      res.status(400).json({ error: `Model "${ast.model}" not found` })
      return
    }

    let result: unknown

    if (translated.operation === 'count') {
      result = await model.count({
        where: whereWithAcl,
      })
    } else {
      const findManyArgs = {
        ...translated.args,
        where: whereWithAcl,
      }

      result = await model.findMany(findManyArgs)
    }

    const duration = Date.now() - startTime

    logger.info('Python query executed', {
      userId,
      model: ast.model,
      operation: translated.operation,
      resultCount: Array.isArray(result) ? result.length : 1,
      duration,
    })

    res.json({ data: result })
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('Python query failed', {
      error: error,
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body,
      duration,
    })

    res.status(500).json({
      error: 'Query execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
