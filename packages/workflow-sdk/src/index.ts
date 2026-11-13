// @xyne/workflow-sdk — public API surface

// ─── Engine ───

export { ServiceRegistry } from './engine/service-registry.js';
export { PauseStep } from './engine/pause-step.js';
export { BranchSignal, isJumpingStep } from './engine/branch-signal.js';
export type { JumpKind, JumpSignal, JumpingStep } from './engine/branch-signal.js';
export { recordKey, framePrefix, leafStepId } from './engine/node-path.js';
export {
  VariableResolver,
  resolvePath,
  stripNullForOptionalKeys,
} from './engine/variable-resolver.js';
export { ConditionEvaluator } from './engine/condition-evaluator.js';
export { ConfigValidator } from './engine/config-validator.js';
export { getAvailableContext } from './engine/available-context.js';
export type { AvailableContext } from './engine/available-context.js';
export { WorkflowExecutor } from './engine/workflow-executor.js';
export {
  CredentialResolver,
  CredentialResolutionError,
} from './engine/credential-resolver.js';
export type {
  CredentialConsumer,
  CredentialScope,
  CredentialResolutionReason,
} from './engine/credential-resolver.js';
export {
  markCredentialField,
  CREDENTIAL_NAME_FORMAT,
} from './util/credential-slot-schema.js';
export type {
  ExecutorOptions,
  ExecutorLogger,
} from './engine/workflow-executor.js';

// ─── Steps ───

export {
  BaseStep,
  BaseActionStep,
  BaseControlFlowStep,
  StepKind,
  createPauseFunction,
} from './steps/base-step.js';
export type {
  StepExecutionContext,
  ControlFlowExecutionContext,
  CredentialSlot,
  DeclaredOutput,
  BranchModel,
  BranchStepOutputs,
  JumpBehavior,
} from './steps/base-step.js';

export type { StepSummary, StepDescriptor } from './steps/step-descriptor.js';

// ─── Triggers ───

export { BaseTrigger } from './triggers/base-trigger.js';
export { EventTrigger } from './triggers/event-trigger.js';
export { ManualTrigger } from './triggers/manual-trigger.js';
export { ApiTrigger } from './triggers/api-trigger.js';
export { WebhookTrigger } from './triggers/webhook-trigger.js';
export type { HydrateResult, TriggerExecutionContext } from './triggers/base-trigger.js';

// ─── Inbound webhook ingest ───

export { headerValue } from './ingest/headers.js';
export { parseInboundBody, MalformedBodyError } from './ingest/body.js';
export { matchesTriggerFilter } from './ingest/filter.js';
export type {
  FieldOption,
  FieldOptionsContext,
  FieldOptionsPage,
  HasOptions,
} from './schema/options.js';
export {
  durationMs,
  isDelayedStart,
  MAX_START_DELAY_MS,
  resolveStartAt,
  startNeedsPayload,
  startSkipReason,
  TriggerStartSchema,
} from './ingest/start-policy.js';
export type {
  Duration,
  StartAnchor,
  StartDecision,
  TriggerStart,
} from './ingest/start-policy.js';
export type {
  InboundHttpRequest,
  RawInboundRequest,
  InboundReply,
  InboundEvent,
  TriggerEvent,
  Translation,
  WebhookIngestResult,
} from './ingest/types.js';
export { CronTrigger } from './triggers/cron-trigger.js';
export type {
  CronSchedule,
  CronPollContext,
} from './triggers/cron-trigger.js';

export type {
  TriggerSummary,
  TriggerDescriptor,
} from './triggers/trigger-descriptor.js';

// ─── Connectors ───
//
// How a deployment says what it provides. Everything the engine can run — the
// built-ins included — reaches it through a connector registered here.

export { BaseConnector } from './connectors/core/base-connector.js';
export type { AnyStep, AnyTrigger } from './connectors/core/base-connector.js';
export {
  ConnectorRegistry,
  ConnectorRegistrationError,
  UnknownComponentError,
} from './connectors/core/connector-registry.js';
export type {
  RegisteredStep,
  RegisteredTrigger,
  RegisteredCredential,
} from './connectors/core/connector-registry.js';
export {
  defineCredential,
  acceptsCredential,
  declareSteps,
  NO_CREDENTIAL,
  CREDENTIAL_TYPE_PATTERN,
} from './connectors/core/credentials.js';
export type {
  CredentialDefinition,
  CredentialRequirement,
} from './connectors/core/credentials.js';
export { BuiltinConnector } from './connectors/builtin/builtin-connector.js';
export {
  BUILTIN_CREDENTIALS,
  BUILTIN_BEARER,
  BUILTIN_BASIC,
  BUILTIN_CUSTOM_HEADER,
  BUILTIN_OAUTH2_CLIENT_CREDENTIALS,
} from './connectors/builtin/credentials.js';

// ─── Built-in Triggers (default implementations) ───

export { DefaultManualTrigger } from './connectors/builtin/triggers/default-manual-trigger.js';
export { DefaultCronTrigger } from './connectors/builtin/triggers/default-cron-trigger.js';
export { DefaultEventTrigger } from './connectors/builtin/triggers/default-event-trigger.js';
export { DefaultWebhookV2Trigger } from './connectors/builtin/triggers/default-webhook-v2-trigger.js';

// ─── Persistence ───

export type {
  PersistenceAdapter,
  QueueAdapter,
  SchedulerAdapter,
  WorkflowRecord,
  FolderRecord,
  CredentialRecord,
  ExecutionOrigin,
  ExecutionRecord,
  ExecutionStateRecord,
  ExecutionPauseType,
  StepRecord,
  // Paging — one shape for every list, cursor-only by design.
  CursorPage,
  Paged,
  // Approvals inbox, answered by the adapter in one joined query.
  PendingApprovalRow,
  PendingApprovalQuery,
  PendingApprovalFacets,
  PendingApprovalSort,
  PendingApprovalBucket,
  PendingApprovalCountQuery,
  LastRun,
} from './persistence/types.js';

// Page bounds, so a host writing its own adapter can honour the same limits.
export { DEFAULT_PAGE, MAX_PAGE, resolvePage } from './runtime/paging.js';

export { InMemoryPersistenceAdapter } from './persistence/in-memory-adapter.js';

// ─── Storage ───

export type { StorageAdapter, StorageFile, StorageInfo, StorageScope } from './storage/types.js';
export { InMemoryStorageAdapter } from './storage/in-memory-adapter.js';
export {
  createFileAccess,
  AttachmentTooLargeError,
  StorageUnavailableError,
  DEFAULT_BUFFER_LIMIT_BYTES,
} from './storage/files.js';
export type { FileAccess } from './storage/files.js';
export type {
  SandboxAdapter,
  SandboxSession,
  SandboxHandle,
  SandboxFileUpload,
  SandboxArtifact,
  SandboxExecResult,
  SandboxExecOptions,
} from './sandbox/types.js';
export { bindSandboxSession } from './sandbox/types.js';

// ─── Types (re-export barrel) ───

export type { ControlFlowStepType } from './types/index.js';
export {
  // Known types
  BuiltinStepType,
  BuiltinStepTypeSchema,
  CONVERSATIONAL_FLOW_KIND,
  GateCategory,
  ControlFlowStepTypeSchema,
  CONTROL_FLOW_STEP_TYPES,
  BuiltinTriggerType,
  BuiltinTriggerTypeSchema,
  // Categories
  TriggerCategory,
  TriggerCategorySchema,
  // Operators
  ConditionOperator,
  ConditionOperatorSchema,
  VALUE_LESS_OPERATORS,
  OPERATOR_DESCRIPTORS,
  // Status
  WorkflowStatus,
  WorkflowStatusSchema,
  isLiveStatus,
  isProposalStatus,
  isTerminalProposalStatus,
  ExecutionStatus,
  ExecutionStatusSchema,
  // Approval policy
  ApprovalRequirement,
  // Validation
  ValidationIssueCode,
  ValidationIssueCodeSchema,
  // Workflow config schemas
  variableRef,
  getVariableRefInnerSchema,
  LeafConditionSchema,
  ConditionSchema,
  WorkflowSettingsSchema,
  readDottedPath,
  // Workflow variables (author-time constants)
  WorkflowVariableSchema,
  VariableKeySchema,
  projectVariables,
  varsJsonSchema,
} from './types/index.js';

export type {
  // Operators
  OperatorDescriptor,
  // Step / trigger types
  StepType,
  TriggerType,
  StepCategory,
  // Approval policy
  ApprovalConfig,
  ApprovalGate,
  // Validation
  ValidationIssue,
  ValidationIssueLocation,
  ValidationResult,
  // Context
  TriggerContext,
  StepContextEntry,
  WorkflowContext,
  // Pause
  PausePathSegment,
  PausePath,
  PauseDisplaySection,
  PauseFormFieldOption,
  PauseFormField,
  PauseForm,
  PauseAction,
  PauseState,
  // Step events
  StepProgressEventType,
  StepProgressEvent,
  StepEventRecord,
  // Workflow config
  LeafCondition,
  Condition,
  ActionStepConfig,
  ConditionalStepConfig,
  SwitchCaseEntry,
  SwitchStepConfig,
  WorkflowStepConfig,
  StepConfigBase,
  StepGroup,
  WorkflowSettings,
  WorkflowConfig,
  StepCompletionGate,
  // Workflow variables (author-time constants)
  WorkflowVariable,
  WorkflowVariableType,
  VariableValue,
  JsonValue,
} from './types/index.js';

// ─── Util ───

export {
  VARIABLE_REF_REGEX,
  tokenize,
  isPureRef,
  extractRefPath,
  collectRefs,
  parseRef,
  findStepsReferencing,
} from './util/variable-ref.js';

export type { VariableRefToken, FoundRef, ParsedRef } from './util/variable-ref.js';

export { collectGateAssignees } from './util/gate-assignees.js';

// ─── Expressions (`{% ... %}`) ───
//
// Two modules, by weight. `expression-format.js` and the catalogue are plain
// data and free to import anywhere. `util/expression.js` pulls in the JSONata
// engine, so anything in a browser should reach for it lazily, at the one place
// that needs to parse or evaluate.

export {
  EXPRESSION_REGEX,
  REF_OR_EXPRESSION_REGEX,
  EXPRESSION_ROOTS,
  isExpression,
  hasExpression,
  extractExpressionSource,
  tokenizeExpressions,
  toExpressionValue,
  collectExpressions,
} from './expression/format.js';
export type { ExpressionToken, FoundExpression } from './expression/format.js';

export {
  EXPRESSION_LIMITS,
  compileExpression,
  clearExpressionCache,
  expressionAst,
  inspectExpression,
  refsInExpression,
} from './expression/parse.js';
export type { ExpressionFault, ExpressionFaultKind } from './expression/parse.js';
export { inferExpressionType } from './expression/infer.js';
export type { InferredExpression, TypeFault } from './expression/infer.js';

export { EXPRESSION_FUNCTIONS, expressionFunction, takesOf } from './expression/catalogue.js';
export type { ExpressionFunction } from './expression/catalogue.js';

// JSONata's own signatures — generated from the installed package, and the
// notation reader for them. Both are plain data: no engine comes with them.
export { BUILTIN_SIGNATURES, isBuiltin, builtinSignature } from './expression/signatures.js';
export { parseSignature, paramAt } from './expression/signature.js';

// A computation simple enough for a form to describe — the language knowledge a
// form needs, kept out of the editor.
export {
  COMPARISON_OPS,
  FORMABLE_FUNCTIONS,
  isFormable,
  argumentSlots,
  takesSeveral,
  wantsAt,
} from './expression/form/model.js';
export {
  writeComputation,
  writeSelection,
} from './expression/form/write.js';
export {
  readComputation,
} from './expression/form/read.js';
export type {
  Computation,
  ComparisonOp,
  ItemFilter,
  ValueSelection,
} from './expression/form/model.js';
export type { Signature, SignatureParam } from './expression/signature.js';

export {
  resolveExpressions,
  resolveReference,
  resolveValue,
  ExpressionError,
} from './engine/resolve-expressions.js';
export type { ExpressionResolution, EvaluatedExpression } from './engine/resolve-expressions.js';

export {
  ensureCitationPath,
  tryCitationPath,
  parseCitationPath,
  resolveCitationPath,
} from './util/citation-path.js';

// ─── Common (browser-safe shared primitives) ───
//
// Also exported from the `@xyne/workflow-sdk/common` subpath so UIs can
// import from there without pulling in Node-only modules.

export type {
  Attachment,
  CitationRef,
  Locator,
  RefCitation,
  UrlCitation,
  DerivedCitation,
  SourceCitation,
  CitationMap,
  ResumePayload,
  ResumeAttachment,
  ResumeAction,
} from './common/index.js';
export {
  isExecutable,
  extensionOf,
  BLOCKED_EXECUTABLE_MIME_TYPES,
  BLOCKED_EXECUTABLE_EXTENSIONS,
  AttachmentSchema,
  CitationRefSchema,
  LocatorSchema,
  DerivedCitationSchema,
  CITATION_REF_JSON_SCHEMA,
  CITATION_DIRECTIVE_ATTRS,
  isCitationRef,
  isCitationRefArray,
} from './common/index.js';

// ── Type-only exports ──
export type {
  // Status & auth type enums
  CredentialStatus,
  CredentialAuthType,
  // Per-auth-type value shapes
  BearerValues,
  BasicValues,
  CustomHeaderValues,
  OAuth2ClientCredentialsValues,
  SecretValues,
  CredentialAuth,
  CredentialValuesOf,
  AuthSpecificValues,
  // Public API contract types
  CredentialSummary,
  ResolvedCredential,
  CreateCredentialInput,
  CreateCredentialRequest,
  CredentialTypeRef,
  CredentialTypeDescriptor,
  ConnectorCredentialTypes,
  ReplaceCredentialValuesInput,
  CredentialListItem,
  CredentialListResponse,
  // Registry types (for UI form rendering)
  CredentialFieldControl,
  CredentialRegistryInputField,
  CredentialRegistryEntryField,
  CredentialRegistryEntry,
} from './common/credentials.js';

// ── Runtime value exports (Zod schemas, registry, validation helper) ──

export {
  CredentialStatusSchema,
  BearerValuesSchema,
  BasicValuesSchema,
  CustomHeaderValuesSchema,
  OAuth2ClientCredentialsValuesSchema,
  SecretValuesSchema,
  CredentialAuthSchema,
  CREDENTIAL_VALUE_SCHEMAS,
  validateCredentialAuth,
  validateCredentialValues,
  applyResolvedCredentialAuth,
  credentialValues,
  CredentialNameSchema,
  CREDENTIAL_AUTH_REGISTRY,
} from './common/credentials.js';

export { zodToJsonSchemaRecord } from './util/schema-convert.js';
export { withOptions, isOptionMarked } from './util/schema-marks.js';
export type { Literal } from './types/literal.js';

// ─── Type Compatibility (shared by picker, validator, runtime) ───

export {
  TYPE_KINDS,
  kindsCompatible,
  kindOfJsonType,
} from './util/type-compat.js';
export {
  assignableToField,
  assignableToArgument,
  baseKind,
  elementType,
  sayType,
  unify,
} from './expression/types.js';
export type {
  TypeKind,
} from './util/type-compat.js';
export type {
  ExprType,
} from './expression/types.js';

// ─── Pause-form → JSON Schema (for step authors deriving resume output types) ───

export { pauseFormToJsonSchema, jsonTypeForFormField } from './util/pause-form-schema.js';

// Attachment schema authoring helpers (server-side: step/trigger authors use
// these to expose attachments consistently across the Zod + JSON-Schema worlds).
export {
  ATTACHMENT_FORMAT,
  ATTACHMENT_JSON_SCHEMA,
  ATTACHMENT_ARRAY_JSON_SCHEMA,
  markAttachmentFields,
} from './common/attachment.js';

// ─── Built-in Steps ───

export {
  LoopStep,
  LoopStepConfigSchema,
} from './connectors/builtin/steps/loop.step.js';
export type {
  LoopStepConfig,
  LoopStepOutput,
} from './connectors/builtin/steps/loop.step.js';

export {
  CycleStep,
  CycleStepConfigSchema,
} from './connectors/builtin/steps/cycle.step.js';
export type {
  CycleStepConfig,
  CycleStepOutput,
} from './connectors/builtin/steps/cycle.step.js';

export {
  GoToStep,
  FinishStep,
  JumpStepConfigSchema,
} from './connectors/builtin/steps/jump.step.js';
export type {
  JumpStepConfig,
} from './connectors/builtin/steps/jump.step.js';

export {
  MapStep,
  MapStepConfigSchema,
} from './connectors/builtin/steps/map.step.js';
export type {
  MapStepConfig,
  MapStepOutput,
  MapItemResult,
} from './connectors/builtin/steps/map.step.js';

export {
  CodeStep,
  CodeStepConfigSchema,
} from './connectors/builtin/steps/code.step.js';
export type {
  CodeStepConfig,
  CodeStepOutput,
} from './connectors/builtin/steps/code.step.js';

export {
  DedupStep,
  DedupStepConfigSchema,
} from './connectors/builtin/steps/dedup.step.js';
export type {
  DedupStepConfig,
  DedupStepOutput,
} from './connectors/builtin/steps/dedup.step.js';

export {
  ParallelStep,
  ParallelStepConfigSchema,
} from './connectors/builtin/steps/parallel.step.js';
export type {
  ParallelStepConfig,
  ParallelStepOutput,
  ParallelAllSettledOutput,
  ParallelRaceOutput,
  ParallelSettledBranchResult,
} from './connectors/builtin/steps/parallel.step.js';

export {
  WaitForHumanStep,
  WaitForHumanConfigSchema,
} from './connectors/builtin/steps/wait-for-human.step.js';
export type {
  WaitForHumanConfig,
  WaitForHumanOutput,
} from './connectors/builtin/steps/wait-for-human.step.js';

export {
  WaitForWebhookStep,
  WaitForWebhookConfigSchema,
} from './connectors/builtin/steps/wait-for-webhook.step.js';
export type {
  WaitForWebhookConfig,
  WaitForWebhookOutput,
} from './connectors/builtin/steps/wait-for-webhook.step.js';

export {
  DelayStep,
  DelayStepConfigSchema,
} from './connectors/builtin/steps/delay.step.js';
export type {
  DelayStepConfig,
  DelayStepOutput,
} from './connectors/builtin/steps/delay.step.js';

// ─── Continuing a run from outside ───

export type { Address, Delivery, DeliveryOutcome } from './completion/types.js';
export { httpStatusFor } from './completion/types.js';

export {
  ClassifierAgentStep,
  ClassifierAgentStepConfigSchema,
  DEFAULT_CLASSIFIER_ENDPOINT,
} from './connectors/builtin/steps/classifier-agent.step.js';
export type {
  ClassifierAgentStepConfig,
  ClassifierAgentStepOutput,
} from './connectors/builtin/steps/classifier-agent.step.js';

export {
  HttpRequestStep,
  HttpRequestStepConfigSchema,
  HttpMethodSchema,
  HttpRawContentTypeSchema,
  HttpResponseSchema,
  HttpBodySchema,
} from './connectors/builtin/steps/http-request.step.js';
export type {
  HttpRequestStepConfig,
  HttpRequestStepOutput,
  HttpMethod,
  HttpRawContentType,
  HttpResponseConfig,
  HttpResponseType,
  HttpBody,
} from './connectors/builtin/steps/http-request.step.js';

// ─── Runtime ───

export { WorkflowRuntime } from './runtime/workflow-runtime.js';
export type {
  ExecutionResult,
  RuntimeOptions,
  RuntimeConfig,
  DispatchEventInput,
  MutationOptions,
  ActivationOutcome,
  PendingWorkflowSummary,
  ResumeInput,
} from './runtime/types.js';

// ─── Event Bus ───
//
// `InMemoryEventBus` is the default and suits any host that runs in one process.
// Split the queue worker from the HTTP API and it stops working *silently* — that
// host must implement `EventBusAdapter` over a real broker instead.

export { InMemoryEventBus } from './events/in-memory-adapter.js';
export { executionTopic } from './events/types.js';
export { workflowTopic } from './events/types.js';
export { folderTopic } from './events/types.js';
export { rootTopic } from './events/types.js';
export type {
  EventBusAdapter,
  EventTopic,
  BusEvent,
  BusListener,
  Unsubscribe,
  ExecutionStreamEvent,
  WorkflowChangeEvent,
  WorkflowChangeKind,
  RunChangeEvent,
} from './events/types.js';
export { createEventChannel } from './util/event-channel.js';
export type { EventChannel } from './util/event-channel.js';

// ─── Authorization ───

export type {
  WorkflowAuthorizer,
  Action,
  ResourceType,
  ResourceRef,
  ApprovalStepRecord,
} from './authz/types.js';
export type { Register, ResourceAttributes, AttributedResource } from './authz/attributes.js';
export {
  WORKFLOW_ACTIONS,
  EXECUTION_ACTIONS,
  FOLDER_ACTIONS,
  CONTAINER_ACTIONS,
  CREDENTIAL_ACTIONS,
  ALL_ACTIONS,
  refLabel,
} from './authz/types.js';
export type { IdScope } from './authz/id-scope.js';
export { applyIdScope } from './authz/id-scope.js';
export {
  AllowAllAuthorizer,
  AccessDeniedError,
  ResourceNotFoundError,
} from './authz/default.js';

// ─── Router ───

export { createWorkflowRouter } from './router/workflow-router.js';
export type {
  AuthContext,
  RouterOptions,
  RouteResponse,
  RouteRequest,
  RouteAccess,
  RouteDefinition,
} from './router/types.js';

// ─── Trigger filter ───

export { TriggerFilterSchema, TRIGGER_FILTER_SCOPE } from './types/workflow-config.js';
export { promptLines } from './types/pause-state.js';
export type { TriggerFilter } from './types/workflow-config.js';
