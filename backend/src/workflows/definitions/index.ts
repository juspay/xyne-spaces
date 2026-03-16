import { workflowRegistry } from '../registry/workflowRegistry'
import { userOnboardingWorkflow } from './userOnboarding'
import { bugWorkflow } from './bug-workflow/bugWorkflow'
import { bugWorkflowEval } from './bug-workflow/bugWorkflowEval'
import { bugWorkflowEvalInnerSteps } from './bug-workflow/bugWorkflowEvalInnerSteps'
import { bugWorkflowEvalInnerStepsExperimental } from './bugWorkflowEvalInnerStepsExperimental'
import { featureImplementationWorkflow } from './featureImplementationWorkflow'
import { featurePlanningWorkflow } from './featurePlanningWorkflow'
import { xyneSpacesFeatureImplementationWorkflow} from './xyne-spaces-workflows'
import { xyneSpacesPlanReviewLoopWorkflow } from './plan-review-loop'
import { fidoServerWorkflow } from './fido-workflow/fidoWorkflow'
import { connectorMigrationWorkflow } from './connectorMigration'
import { coderWorkflow } from './coder-workflow/coderWorkflow'
import { queryWorkflow } from './query-workflow/queryWorkflow'
import { investigationWorkflow } from './investigation-workflow/investigationWorkflow'
import { geniusInvestigationWorkflow } from './investigation-workflow/geniusInvestigationWorkflow'
import { geniusQueryWorkflow } from './genius-query-workflow/geniusQueryWorkflow'
import { stageApprovalWorkflow } from './stageApprovalWorkflow'
import { networkDocumentWorkflow } from './network-document-workflow/networkDocumentWorkflow'
import { integrityDebugWorkflow } from './integrity-debug-workflow/integrityDebugWorkflow'
import { xyneAutoRcaWorkflow } from './xyne-auto-rca-workflow/xyneAutoRcaWorkflow'
import { versionBumpWorkflow } from './version-bump-workflow/versionBumpWorkflow'
import { WorkflowType } from '../types/workflow-enums'
import {logger} from '@/utils/logger';

// Central workflow definitions registry - single source of truth
export const WORKFLOW_DEFINITIONS = {
  [WorkflowType.USER_ONBOARDING]: userOnboardingWorkflow,
  [WorkflowType.BUG_WORKFLOW]: bugWorkflow,
  [WorkflowType.BUG_WORKFLOW_EVAL]: bugWorkflowEval,
  [WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS]: bugWorkflowEvalInnerSteps,
  [WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL]: bugWorkflowEvalInnerStepsExperimental,
  [WorkflowType.FEATURE_IMPLEMENTATION]: featureImplementationWorkflow,
  [WorkflowType.FEATURE_PLANNING]: featurePlanningWorkflow,
  [WorkflowType.XYNE_SPACES_FEATURE_IMPLEMENTATION]: xyneSpacesFeatureImplementationWorkflow,
  [WorkflowType.XYNE_SPACES_PLAN_REVIEW_LOOP]: xyneSpacesPlanReviewLoopWorkflow,
  [WorkflowType.FIDO_SERVER_WORKFLOW]: fidoServerWorkflow,
  [WorkflowType.CONNECTOR_MIGRATION]: connectorMigrationWorkflow,
  [WorkflowType.CODER_WORKFLOW]: coderWorkflow,
  [WorkflowType.QUERY_WORKFLOW]: queryWorkflow,
  [WorkflowType.INVESTIGATION_WORKFLOW]: investigationWorkflow,
  [WorkflowType.GENIUS_INVESTIGATION_WORKFLOW]: geniusInvestigationWorkflow,
  [WorkflowType.GENIUS_QUERY_WORKFLOW]: geniusQueryWorkflow,
  [WorkflowType.STAGE_APPROVAL_WORKFLOW]: stageApprovalWorkflow,
  [WorkflowType.NETWORK_DOCUMENT_PROCESSING]: networkDocumentWorkflow,
  [WorkflowType.INTEGRITY_DEBUG_WORKFLOW]: integrityDebugWorkflow,
  [WorkflowType.XYNE_AUTO_RCA_WORKFLOW]: xyneAutoRcaWorkflow,
  [WorkflowType.VERSION_BUMP_WORKFLOW]: versionBumpWorkflow,
} as const

export function registerAllWorkflows(): void {
  logger.info('Registering workflow definitions...')

  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.USER_ONBOARDING])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.BUG_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.BUG_WORKFLOW_EVAL])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.FEATURE_IMPLEMENTATION])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.FEATURE_PLANNING])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.XYNE_SPACES_FEATURE_IMPLEMENTATION])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.XYNE_SPACES_PLAN_REVIEW_LOOP])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.FIDO_SERVER_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.CONNECTOR_MIGRATION])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.CODER_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.QUERY_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.INVESTIGATION_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.GENIUS_INVESTIGATION_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.GENIUS_QUERY_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.STAGE_APPROVAL_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.NETWORK_DOCUMENT_PROCESSING])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.INTEGRITY_DEBUG_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.XYNE_AUTO_RCA_WORKFLOW])
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.VERSION_BUMP_WORKFLOW])
}

export { workflowRegistry } from '../registry/workflowRegistry'
