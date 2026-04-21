import { Router } from 'express'
import { repositories } from '@/database/repositories'

import { TicketRepository } from '@/database/repositories/ticketRepository'
import { WorkflowType, ConnectorMigrationContext } from '@/workflows/types/workflow-enums'
import { v4 as uuidv4 } from 'uuid'
import { workflowStatusSyncService } from '@/workflows/services/workflowStatusSyncService'
import { DatabaseClient } from '@/database/client'
import {logger} from '@/utils/logger';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { config } from '@/config/env';

const router = Router()
const prisma = DatabaseClient.getInstance()
const ticketRepository = new TicketRepository()

// POST /api/connector-migration/trigger - Trigger a new connector migration workflow
router.post('/trigger', async (req, res) => {
  try {
    const {
      connectorName,
      upiFlowsOnly = false,
      maxIterations = 3,
      continuousImprovement = true,
      jenkinsConfig
    } = req.body

    // Validate required fields
    if (!connectorName) {
      return res.status(400).json({
        success: false,
        error: 'connectorName is required',
        timestamp: new Date().toISOString()
      })
    }

    // Validate connector name format
    if (!/^[a-zA-Z0-9_-]+$/.test(connectorName)) {
      return res.status(400).json({
        success: false,
        error: 'connectorName must contain only alphanumeric characters, hyphens, and underscores',
        timestamp: new Date().toISOString()
      })
    }

    // Validate maxIterations
    if (maxIterations < 1 || maxIterations > 10) {
      return res.status(400).json({
        success: false,
        error: 'maxIterations must be between 1 and 10',
        timestamp: new Date().toISOString()
      })
    }

    // Create ticket with unique title
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    // Generate xyneId using PostgreSQL sequence
    const result = await prisma.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('ticket_xyne_id_seq')`
    const xyneId = `XYNE-${result[0].nextval}`

    const ticket = await ticketRepository.createTicket({
      title: `Connector Migration: ${connectorName} - ${timestamp}`,
      description: `Automated connector migration workflow for ${connectorName}${upiFlowsOnly ? ' (UPI flows only)' : ''}`,
      createdBy: 'system',
      updatedBy: 'system',
      conversationId: 'system-connector-migration',
      projectId: 'connector-migration',
      workspaceId: config.defaultWorkspaceId,
      userGroupId: 'system',
      boardId: 'system',
      xyneId
    })

    await syncConversationTicketMdFromPrismaTicket(prisma, ticket);

    // Create workflow context
    const context: ConnectorMigrationContext = {
      ticketId: ticket.id,
      connectorName,
      upiFlowsOnly,
      maxIterations,
      continuousImprovement,
      jenkinsConfig,
      metadata: {
        triggeredBy: 'api',
        triggeredAt: new Date().toISOString(),
        requestId: (req as any).requestId || uuidv4()
      }
    }

    // Create workflow
    const workflowId = uuidv4()
    const workflow = await repositories.workflows.create({
      id: workflowId,
      ticketId: ticket.id,
      workflowName: 'Connector Migration',
      workflowType: WorkflowType.CONNECTOR_MIGRATION,
      status: 'NEW',
      metadata: JSON.stringify({
        workflowType: WorkflowType.CONNECTOR_MIGRATION,
        context
      })
    })

    // Create workflow execution
    const executionId = uuidv4()
    const execution = await repositories.workflowExecutions.create({
      id: executionId,
      workflow: {
        connect: { id: workflow.id }
      },
      workflowType: WorkflowType.CONNECTOR_MIGRATION,
      context: JSON.stringify(context),
      status: 'PENDING'
    })

    logger.info(`✅ Connector migration workflow queued for ${connectorName}`)
    logger.info(`   - Ticket ID: ${ticket.id}`)
    logger.info(`   - Workflow ID: ${workflow.id}`)
    logger.info(`   - Execution ID: ${execution.id}`)
    logger.info(`   - UPI Flows Only: ${upiFlowsOnly}`)
    logger.info(`   - Max Iterations: ${maxIterations}`)
    logger.info(`   - Continuous Improvement: ${continuousImprovement}`)

    return res.status(201).json({
      success: true,
      data: {
        ticketId: ticket.id,
        ticketXyneId: ticket.xyneId,
        workflowId: workflow.id,
        executionId: execution.id,
        connectorName,
        status: 'PENDING',
        config: {
          upiFlowsOnly,
          maxIterations,
          continuousImprovement
        },
        message: `Connector migration workflow queued for ${connectorName}`
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    logger.error('Error triggering connector migration:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to trigger connector migration workflow',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

// GET /api/connector-migration/status/:executionId - Get workflow execution status
router.get('/status/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params

    const execution = await repositories.workflowExecutions.findFullExecution(executionId)

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Workflow execution not found',
        timestamp: new Date().toISOString()
      })
    }

    // Get metadata from workflow (not execution, as execution doesn't have metadata field)
    const workflowMetadata = execution.workflow?.metadata ? JSON.parse(execution.workflow.metadata) : {}
    const context = workflowMetadata.context || {}

    // Calculate progress percentage
    let progress = 0
    if (context.repositorySetup?.bothSuccessful) progress += 20
    if (context.codegenPhase?.codeGenerated) progress += 30
    if (context.buildArtPhase?.buildSuccess) progress += 30
    if (context.gitOperations?.bothSuccessful) progress += 15
    if (context.jenkinsExecution?.success) progress += 5

    const response = {
      success: true,
      data: {
        executionId: execution.id,
        workflowId: execution.workflowId,
        ticketId: execution.workflow?.ticketId,
        status: execution.status,
        progress: Math.min(progress, 100),
        connectorName: context.connectorName,
        config: {
          upiFlowsOnly: context.upiFlowsOnly || false,
          maxIterations: context.maxIterations || 3,
          continuousImprovement: context.continuousImprovement || true
        },
        phases: {
          repositorySetup: {
            completed: !!context.repositorySetup,
            success: context.repositorySetup?.bothSuccessful || false,
            workingDirectory: context.workingDirectory,
            setupAt: context.repositorySetup?.setupAt
          },
          codeGeneration: {
            completed: !!context.codegenPhase,
            promptsGenerated: context.codegenPhase?.promptsGenerated || false,
            codeGenerated: context.codegenPhase?.codeGenerated || false,
            xynePromptsExecuted: context.codegenPhase?.xynePromptsExecuted || false
          },
          continuousImprovement: {
            iterationCount: context.iterationCount || 0,
            maxIterations: context.maxIterations || 3,
            buildStatus: {
              cargoSuccess: context.buildPhase?.cargoResult?.success || false,
              nixCabalSuccess: context.buildPhase?.nixCabalResult?.success || false,
              overallSuccess: context.buildArtPhase?.buildSuccess || false,
              fixesApplied: {
                cargo: context.buildPhase?.cargoResult?.fixApplied || false,
                nixCabal: context.buildPhase?.nixCabalResult?.fixApplied || false
              }
            },
            artTesting: {
              completed: context.artEvaluationPhase?.promptsEnhanced || false
            }
          },
          gitOperations: {
            completed: !!context.gitOperations,
            success: context.gitOperations?.bothSuccessful || false,
            branchName: context.gitOperations?.branchName,
            executedAt: context.gitOperations?.executedAt
          },
          jenkins: {
            triggered: context.jenkinsExecution?.triggered || false,
            success: context.jenkinsExecution?.success || false,
            url: context.jenkinsExecution?.url,
            triggeredAt: context.jenkinsExecution?.triggeredAt
          }
        },
        timestamps: {
          createdAt: execution.createdAt,
          updatedAt: execution.updatedAt
        },
        workflowCompleted: context.metadata?.workflowCompleted || false,
        finalResult: context.metadata?.finalResult
      },
      timestamp: new Date().toISOString()
    }

    return res.json(response)

  } catch (error) {
    logger.error('Error fetching workflow status:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch workflow status',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

// GET /api/connector-migration/executions - Get all connector migration executions
router.get('/executions', async (req, res) => {
  try {
    const { status, limit = '10', offset = '0' } = req.query

    const queryOptions: any = {
      skip: parseInt(offset as string),
      take: Math.min(parseInt(limit as string), 100), // Max 100 items per request
      orderBy: { createdAt: 'desc' },
      where: {}
    }

    if (status) {
      queryOptions.where.status = status
    }

    // Get workflows of type CONNECTOR_MIGRATION
    const workflows = await repositories.workflows.findMany({
      where: { workflowType: WorkflowType.CONNECTOR_MIGRATION },
      orderBy: { createdAt: 'desc' }
    })

    const workflowIds = workflows.map(w => w.id)

    if (workflowIds.length === 0) {
      return res.json({
        success: true,
        data: {
          executions: [],
          total: 0,
          limit: queryOptions.take,
          offset: queryOptions.skip
        },
        timestamp: new Date().toISOString()
      })
    }

    // Get executions for these workflows
    queryOptions.where.workflowId = { in: workflowIds }
    const executions = await repositories.workflowExecutions.findMany(queryOptions)

    const formattedExecutions = executions.map(execution => {
      // Get metadata from the workflow, not execution
      const workflowMetadata = (execution as any).workflow?.metadata ? JSON.parse((execution as any).workflow.metadata) : {}
      const context = workflowMetadata.context || {}

      return {
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        connectorName: context.connectorName || 'unknown',
        iterationCount: context.iterationCount || 0,
        progress: {
          repositorySetup: context.repositorySetup?.bothSuccessful || false,
          codeGeneration: context.codegenPhase?.codeGenerated || false,
          buildSuccess: context.buildArtPhase?.buildSuccess || false,
          gitOperations: context.gitOperations?.bothSuccessful || false,
          jenkinsTriggered: context.jenkinsExecution?.triggered || false
        },
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt
      }
    })

    return res.json({
      success: true,
      data: {
        executions: formattedExecutions,
        total: formattedExecutions.length,
        limit: queryOptions.take,
        offset: queryOptions.skip
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    logger.error('Error fetching connector migration executions:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch connector migration executions',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

// GET /api/connector-migration/executions/:executionId/logs - Get execution logs (workflow steps)
router.get('/executions/:executionId/logs', async (req, res) => {
  try {
    const { executionId } = req.params

    const execution = await repositories.workflowExecutions.findFullExecution(executionId)

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Workflow execution not found',
        timestamp: new Date().toISOString()
      })
    }

    const workflowSteps = execution.workflowSteps || []

    const logs = workflowSteps.map(step => ({
      stepId: step.id,
      stepName: step.stepName,
      status: step.status,
      previousStepId: step.previousStepId,
      data: step.data ? JSON.parse(step.data) : {},
      createdAt: step.createdAt,
      updatedAt: step.updatedAt
    }))

    return res.json({
      success: true,
      data: {
        executionId,
        connectorName: 'unknown', // We'll get this from the workflow metadata if needed
        totalSteps: logs.length,
        steps: logs
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    logger.error('Error fetching execution logs:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch execution logs',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

// DELETE /api/connector-migration/executions/:executionId - Cancel a running execution
router.delete('/executions/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params

    const execution = await repositories.workflowExecutions.findById(executionId)

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: 'Workflow execution not found',
        timestamp: new Date().toISOString()
      })
    }

    // Only cancel if execution is not in a terminal state
    const terminalStates = ['SUCCESS', 'FAILURE', 'CANCELLED']
    if (terminalStates.includes(execution.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel execution in ${execution.status} state`,
        timestamp: new Date().toISOString()
      })
    }

    // Update execution status to CANCELLED
    await workflowStatusSyncService.updateWorkflowExecution(executionId, {
      status: 'CANCELLED'
    })

    logger.info(`🛑 Connector migration execution cancelled: ${executionId}`)

    return res.json({
      success: true,
      data: {
        executionId,
        status: 'CANCELLED',
        message: 'Workflow execution cancelled successfully'
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    logger.error('Error cancelling execution:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel execution',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
  }
})

export default router
