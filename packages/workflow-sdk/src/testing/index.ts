/**
 * @xyne/workflow-sdk/testing — Test utilities for host consumers.
 *
 * Provides mock factories for WorkflowContext, StepExecutionContext,
 * and ControlFlowExecutionContext. Intended for use in unit tests
 * when writing custom steps and triggers.
 */

export { createMockContext } from './mock-context.js';
export {
  createMockStepContext,
  createMockControlFlowContext,
  mockResolvedCredential,
} from './mock-step-context.js';

/**
 * The authorization conformance kit — the contract test every host's
 * authorizer + adapter pair should pass. Also available as its own entry point,
 * `@xyne/workflow-sdk/testing/authz-conformance`.
 */
export { authzConformanceCases } from './authz-conformance.js';
export type {
  AuthzConformanceConfig,
  AuthzConformanceFixture,
  ConformanceCase,
} from './authz-conformance.js';

export { TestConnector, testRegistry } from './test-connector.js';
