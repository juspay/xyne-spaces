/**
 * Xyne Spaces Workflows Module
 *
 * This module contains specialized workflows and utilities designed specifically for the Xyne Spaces platform.
 * It provides comprehensive feature implementation workflows with advanced orchestration capabilities.
 *
 * Features:
 * - Fullstack feature implementation workflow
 * - Parallel execution for frontend/backend planning
 * - Iterative implementation with verification
 * - Git tracking and branch management
 * - Comprehensive error handling and recovery
 * - Structured progress tracking and logging
 *
 * @author Xyne Engineering Team
 * @version 1.0.0
 */

// Export the main workflow
export { xyneSpacesFeatureImplementationWorkflow } from './xyneSpacesFeatureImplementationWorkflow'

// Export utilities for potential reuse
export {
  createXyneSpacesAgentConfig,
  extractLastMessageContent,
  parseVerificationResult,
  validateRepoUrl,
  XyneSpacesWorkflowSteps,
  SYSTEM_PROMPTS,
  loadRootGuidelines,
  // Agent configuration factories
  getPlanningConfig,
  getImplementationConfig,
} from './utils'

// Export types for external usage
export type {
  // These types would be defined in the workflow file if needed externally
} from './xyneSpacesFeatureImplementationWorkflow'