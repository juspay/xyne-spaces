import { createFileAccess } from '../storage/files.js';
import type { StorageAdapter } from '../storage/types.js';
import type {
  StepExecutionContext,
  ControlFlowExecutionContext,
} from '../steps/base-step.js';
import { createPauseFunction } from '../steps/base-step.js';
import { ServiceRegistry } from '../engine/service-registry.js';
import type { WorkflowContext } from '../types/context.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { StepProgressEvent } from '../types/step-events.js';
import { createMockContext } from './mock-context.js';
import type {
  ResolvedCredential,
  AuthSpecificValues,
  CredentialAuthType,
  CredentialStatus,
} from '../common/credentials.js';
import { validateCredentialAuth } from '../common/credentials.js';

interface MockStepContextOptions<
  TServices extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Override the full workflow context. */
  workflow?: WorkflowContext;
  /** Override runtime metadata. */
  runtime?: Partial<StepExecutionContext['runtime']>;
  /** Provide a pre-built ServiceRegistry. */
  services?: ServiceRegistry<TServices>;
  /** Override static data methods. */
  staticData?: Partial<StepExecutionContext['staticData']>;
  /** Override logger methods. */
  log?: Partial<StepExecutionContext['log']>;
  /** Override emit function. */
  emit?: (event: StepProgressEvent) => void;
  /** Prior step data — set on review-gate retry or rerunFromStep. */
  priorState?: Readonly<Record<string, unknown>>;
  /** This step's config before variable resolution — `{{refs}}` intact. */
  rawConfig?: Record<string, unknown>;
  /**
   * Inject a storage adapter. The mock wraps it the way the executor does, so
   * a test exercises `ctx.files` rather than a hand-built stand-in; omit it and
   * `ctx.files.available` is false.
   */
  storage?: StorageAdapter;
  /** Inject a sandbox adapter (code execution). */
  sandbox?: StepExecutionContext['sandbox'];
  /** Inject credentials already resolved by the executor. */
  credentials?: StepExecutionContext<TServices>['credentials'];
}

/**
 * Create a mock StepExecutionContext for testing action steps.
 *
 * All fields have sensible defaults. The `pause()` function works
 * (it throws `PauseStep`). Logger methods are no-ops by default.
 */
export function createMockStepContext<
  TServices extends Record<string, unknown> = Record<string, unknown>,
>(
  options?: MockStepContextOptions<TServices>,
): StepExecutionContext<TServices> {
  const noop = () => {};
  const noopAsync = () => Promise.resolve();

  return {
    workflow: options?.workflow ?? createMockContext(),
    runtime: {
      executionId: 'exec_test',
      stepId: 'step_test_id',
      stepName: 'step_test',
      isResuming: false,
      attributes: undefined as ResourceAttributes<'workflow'>,
      metadata: {},
      baseUrl: '',
      ...options?.runtime,
    },
    ...(options?.priorState ? { priorState: options.priorState } : {}),
    ...(options?.rawConfig ? { rawConfig: options.rawConfig } : {}),
    files: createFileAccess(options?.storage, {} as never),
    ...(options?.sandbox ? { sandbox: options.sandbox } : {}),
    credentials: options?.credentials ?? {},
    services:
      options?.services ??
      (new ServiceRegistry() as unknown as ServiceRegistry<TServices>),
    staticData: {
      get: options?.staticData?.get ?? (() => Promise.resolve(undefined)),
      set: options?.staticData?.set ?? noopAsync,
      delete: options?.staticData?.delete ?? noopAsync,
    },
    pause: createPauseFunction(),
    emit: options?.emit ?? noop,
    log: {
      info: options?.log?.info ?? noop,
      warn: options?.log?.warn ?? noop,
      error: options?.log?.error ?? noop,
    },
  };
}

/**
 * Create a mock ControlFlowExecutionContext for testing control flow steps.
 *
 * Extends `createMockStepContext` with a `walkBranch` stub that records calls.
 */
export function createMockControlFlowContext<
  TServices extends Record<string, unknown> = Record<string, unknown>,
>(
  options?: MockStepContextOptions<TServices> & {
    /** Custom walkBranch implementation. Default: no-op. */
    walkBranch?: ControlFlowExecutionContext['walkBranch'];
  },
): ControlFlowExecutionContext<TServices> & {
  /** Record of walkBranch calls for assertions. */
  walkBranchCalls: Array<{ steps: unknown[]; context: WorkflowContext; branchKey: string | undefined }>;
} {
  const calls: Array<{ steps: unknown[]; context: WorkflowContext; branchKey: string | undefined }> = [];
  const stepCtx = createMockStepContext(options);

  return {
    ...stepCtx,
    walkBranch:
      options?.walkBranch ??
      (async (steps, context, branchKey) => {
        calls.push({ steps, context, branchKey });
      }),
    walkBranchCalls: calls,
  };
}

export function mockResolvedCredential(
  authType: CredentialAuthType,
  values: AuthSpecificValues,
  opts?: { name?: string; status?: CredentialStatus; credType?: string },
): ResolvedCredential {
  return {
    name: opts?.name ?? `mock_${authType}`,
    credType: opts?.credType ?? `BUILTIN_${authType.toUpperCase()}`,
    status: opts?.status ?? 'ACTIVE',
    ...validateCredentialAuth(authType, values),
  };
}
