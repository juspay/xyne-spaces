/**
 * @xyne/workflow-sdk/builder — pure client-side utilities for workflow UIs.
 *
 * This subpath exports only the utilities needed to build workflow editors,
 * variable pickers, condition builders, and schema-driven forms — without
 * pulling in runtime, persistence, or server-side code.
 *
 * Usage:
 * ```ts
 * import {
 *   tokenize, isPureRef, extractRefPath,
 *   OPERATOR_DESCRIPTORS,
 *   ConditionEvaluator,
 *   zodToJsonSchemaRecord,
 * } from '@xyne/workflow-sdk/builder';
 * ```
 */

// ─── Variable Reference Utilities ───

export {
  VARIABLE_REF_REGEX,
  tokenize,
  isPureRef,
  extractRefPath,
  collectRefs,
  parseRef,
  findStepsReferencing,
} from '../util/variable-ref.js';

export type { VariableRefToken, FoundRef, ParsedRef } from '../util/variable-ref.js';

export {
  ensureCitationPath,
  tryCitationPath,
  parseCitationPath,
  resolveCitationPath,
} from '../util/citation-path.js';

// Runtime (agent-emitted) citations — the counterpart to the author `Citation`
// overlay above: those key into a step's *config*, these travel with output data.
export type {
  CitationRef,
  Locator,
  RefCitation,
  UrlCitation,
  DerivedCitation,
  SourceCitation,
  CitationMap,
} from '../common/citation-ref.js';
export {
  CitationRefSchema,
  LocatorSchema,
  DerivedCitationSchema,
  CITATION_REF_JSON_SCHEMA,
  CITATION_DIRECTIVE_ATTRS,
  isCitationRef,
  isCitationRefArray,
} from '../common/citation-ref.js';

// ─── Available Context ───

export { getAvailableContext } from '../engine/available-context.js';
export type { AvailableContext } from '../engine/available-context.js';

// ─── Variable Resolution ───

export {
  VariableResolver,
  resolvePath,
  stripNullForOptionalKeys,
} from '../engine/variable-resolver.js';

// ─── Expressions (`{% ... %}`) ───

export { EXPRESSION_FUNCTIONS, expressionFunction, takesOf } from '../expression/catalogue.js';
export type { ExpressionFunction } from '../expression/catalogue.js';

// JSONata's own signatures — generated from the installed package, and the
// notation reader for them. Both are plain data: no engine comes with them.
export { BUILTIN_SIGNATURES, isBuiltin, builtinSignature } from '../expression/signatures.js';
export { parseSignature, paramAt } from '../expression/signature.js';

// A computation simple enough for a form to describe — the language knowledge a
// form needs, kept out of the editor.
export {
  COMPARISON_OPS,
  FORMABLE_FUNCTIONS,
  isFormable,
  argumentSlots,
  takesSeveral,
  wantsAt,
} from '../expression/form/model.js';
export {
  writeComputation,
  writeSelection,
} from '../expression/form/write.js';
export {
  readComputation,
} from '../expression/form/read.js';
export type {
  Argument,
  Call,
  Computation,
  ComparisonOp,
  ItemFilter,
  ListFormat,
  ValueSelection,
} from '../expression/form/model.js';
export type { Signature, SignatureParam } from '../expression/signature.js';

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
} from '../expression/format.js';
export type { ExpressionToken, FoundExpression } from '../expression/format.js';

// Parsing needs the JSONata engine — import lazily in the browser.
export { expressionAst, inspectExpression, refsInExpression } from '../expression/parse.js';
export type { ExpressionFault } from '../expression/parse.js';
export { inferExpressionType } from '../expression/infer.js';
export type { InferredExpression, TypeFault } from '../expression/infer.js';

// ─── Condition Evaluation ───

export { ConditionEvaluator } from '../engine/condition-evaluator.js';

// ─── Operators ───

export {
  ConditionOperator,
  ConditionOperatorSchema,
  VALUE_LESS_OPERATORS,
  OPERATOR_DESCRIPTORS,
} from '../types/operators.js';

export type { OperatorDescriptor } from '../types/operators.js';

// ─── Config Schema Helpers ───

export {
  variableRef,
  getVariableRefInnerSchema,
  LeafConditionSchema,
  ConditionSchema,
  TriggerFilterSchema,
  TRIGGER_FILTER_SCOPE,
  readDottedPath,
} from '../types/workflow-config.js';

export type {
  LeafCondition,
  Condition,
  TriggerFilter,
  WorkflowStepConfig,
  WorkflowConfig,
  WorkflowSettings,
  WorkflowRunNaming,
  StepConfigBase,
  StepGroup,
  Citation,
  ActionStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
} from '../types/workflow-config.js';

// ─── Workflow Variables (author-time constants) ───

export {
  WorkflowVariableSchema,
  VariableKeySchema,
  projectVariables,
  varsJsonSchema,
} from '../types/workflow-variable.js';

export type {
  WorkflowVariable,
  WorkflowVariableType,
  VariableValue,
  JsonValue,
} from '../types/workflow-variable.js';

// ─── Trigger start policy (when a matching event becomes a run) ───
//
// The editor renders this itself — it is one fixed shape for every trigger, not a
// connector-defined config — but the CONTRACT comes from here rather than being
// retyped: add a unit or change the cap and the editor follows on its next build.

export {
  durationMs,
  isDelayedStart,
  MAX_START_DELAY_MS,
  startSkipReason,
  TriggerStartSchema,
} from '../ingest/start-policy.js';

export type { Duration, SignedOffset, TriggerStart } from '../ingest/start-policy.js';

// ─── Schema Conversion ───

export { zodToJsonSchemaRecord } from '../util/schema-convert.js';

// ─── Context Types ───

export type {
  TriggerContext,
  StepContextEntry,
  WorkflowContext,
} from '../types/context.js';

// ─── Type Compatibility ───

export {
  TYPE_KINDS,
  kindsCompatible,
  kindOfJsonType,
} from '../util/type-compat.js';
export {
  assignableToField,
  assignableToArgument,
  writeLiteralAs,
  baseKind,
  elementType,
  sayType,
  unify,
} from '../expression/types.js';
export type {
  TypeKind,
} from '../util/type-compat.js';
export type {
  ExprType,
} from '../expression/types.js';
