/**
 * Expressions: `{% … %}` over a workflow's data, in JSONata.
 *
 * Layered so the cheap half stands alone — `format.ts` recognises an expression
 * and imports no parser, which is what lets the config schema and the UI handle
 * one without the engine coming along.
 *
 *   format      the wire format, and where expressions appear in a config
 *   parse       compile · cache · ast · the safety rules   ← the jsonata import
 *   infer       what an expression will produce
 *   types       ExprType, and what may be assigned to what
 *   signature   JSONata's signature notation, parsed
 *   signatures  the generated table of builtin signatures
 *   catalogue   the operations a menu offers
 *   form/       the subset a form can build and read back
 *
 * How the *engine* uses this lives in the engine — `resolve-expressions.ts` for
 * a run, `config-validator.ts` for author time — because those depend on a
 * workflow context, and the language must not.
 */

export {
  EXPRESSION_REGEX,
  EXPRESSION_ROOTS,
  REF_OR_EXPRESSION_REGEX,
  collectExpressions,
  extractExpressionSource,
  hasExpression,
  isExpression,
  toExpressionValue,
  tokenizeExpressions,
} from './format.js';
export type { ExpressionToken, FoundExpression } from './format.js';

export {
  EXPRESSION_LIMITS,
  clearExpressionCache,
  compileExpression,
  expressionAst,
  inspectExpression,
  refsInExpression,
} from './parse.js';
export type { ExpressionFault, ExpressionFaultKind } from './parse.js';

export { inferExpressionType } from './infer.js';
export type { InferredExpression, TypeFault } from './infer.js';

// The shared type vocabulary these rules are written in. Re-exported so a
// consumer of this module does not need a second barrel to turn a schema's
// `type` keyword into something `assignableToArgument` will take.
export { kindOfJsonType, kindsCompatible } from '../util/type-compat.js';
export type { TypeKind } from '../util/type-compat.js';

export {
  assignableToArgument,
  assignableToField,
  baseKind,
  elementType,
  sayType,
  unify,
  writeLiteralAs,
} from './types.js';
export type { ExprType } from './types.js';

export { parseSignature, paramAt } from './signature.js';
export type { Signature, SignatureParam } from './signature.js';
export { BUILTIN_SIGNATURES, builtinSignature, isBuiltin } from './signatures.js';

export { EXPRESSION_FUNCTIONS, expressionFunction, takesOf } from './catalogue.js';
export type { ExpressionFunction } from './catalogue.js';

export {
  COMPARISON_OPS,
  FORMABLE_FUNCTIONS,
  argumentSlots,
  isFormable,
  takesSeveral,
  wantsAt,
} from './form/model.js';
export {
  writeComputation,
  writeLiteral,
  writeSelection,
} from './form/write.js';
export {
  readComputation,
} from './form/read.js';
export type {
  Argument,
  Call,
  Computation,
  ComparisonOp,
  ItemFilter,
  ListFormat,
  ValueSelection,
} from './form/model.js';
