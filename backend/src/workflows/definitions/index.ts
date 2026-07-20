import { workflowRegistry } from '../registry/workflowRegistry'
import { userOnboardingWorkflow } from './userOnboarding'
import { queryWorkflow } from './query-workflow/queryWorkflow'
import { geniusQueryWorkflow } from './genius-query-workflow/geniusQueryWorkflow'
import { stageApprovalWorkflow } from './stageApprovalWorkflow'
import { networkDocumentWorkflow } from './network-document-workflow/networkDocumentWorkflow'
import { itSupportWorkflow } from './it-support-workflow/itSupportWorkflow'
import { WorkflowType } from '../types/workflow-enums'
import {logger} from '@/utils/logger';

// Central workflow definitions registry - single source of truth
export const WORKFLOW_DEFINITIONS = {
  [WorkflowType.USER_ONBOARDING]: userOnboardingWorkflow,
  [WorkflowType.QUERY_WORKFLOW]: queryWorkflow,
  [WorkflowType.GENIUS_QUERY_WORKFLOW]: geniusQueryWorkflow,
  [WorkflowType.STAGE_APPROVAL_WORKFLOW]: stageApprovalWorkflow,
  [WorkflowType.NETWORK_DOCUMENT_PROCESSING]: networkDocumentWorkflow,
  [WorkflowType.IT_SUPPORT_WORKFLOW]: itSupportWorkflow,
} as const

export function registerAllWorkflows(): void {
  logger.info('Registering workflow definitions...')

  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.USER_ONBOARDING])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.QUERY_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.GENIUS_QUERY_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.STAGE_APPROVAL_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.NETWORK_DOCUMENT_PROCESSING])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.IT_SUPPORT_WORKFLOW])
}

export { workflowRegistry } from '../registry/workflowRegistry'
