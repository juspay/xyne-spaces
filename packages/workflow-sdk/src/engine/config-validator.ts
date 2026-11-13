import { z } from 'zod';
import type {
  WorkflowConfig,
  WorkflowStepConfig,
  Citation,
  LeafCondition,
} from '../types/workflow-config.js';
import { getVariableRefInnerSchema, TriggerFilterSchema } from '../types/workflow-config.js';
import { AnchorValueSchema, TriggerStartSchema } from '../ingest/start-policy.js';
import type { Condition, TriggerFilter } from '../types/workflow-config.js';
import type { CredentialSlot } from '../steps/base-step.js';
import { extractRefPath } from '../util/variable-ref.js';
import { resolveCitationPath } from '../util/citation-path.js';
import { ValidationIssueCode } from '../types/validation.js';
import { BuiltinStepType } from '../types/known-types.js';
import type {
  ValidationIssue,
  ValidationIssueLocation,
  ValidationResult,
} from '../types/validation.js';
import type { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import { BaseControlFlowStep } from '../steps/base-step.js';
import type { ComponentRef } from '../types/component-ref.js';
import { isJumpingStep } from './branch-signal.js';
import type { JumpKind } from './branch-signal.js';
import { collectRefs, isPureRef } from '../util/variable-ref.js';
import { OPERATOR_DESCRIPTORS } from '../types/operators.js';
import { isCondition } from './variable-resolver.js';
import { inspectExpression, refsInExpression } from '../expression/parse.js';
import { inferExpressionType } from '../expression/infer.js';
import { collectExpressions, extractExpressionSource } from '../expression/format.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { kindOfJsonType, kindsCompatible, type TypeKind } from '../util/type-compat.js';
import { assignableToArgument, assignableToField, baseKind, sayType, type ExprType } from '../expression/types.js';
import { resolveOutputJsonSchemaOf } from './available-context.js';
import { varsJsonSchema } from '../types/workflow-variable.js';

/**
 * Control steps that park several copies of one step id *at the same time*.
 *
 * Only MAP: it walks its body over every item at once, so three items means
 * three open gates under one id and a caller naming that id means all three.
 * LOOP and CYCLE run their rounds one after another — a round's gate is
 * answered and completed before the next one opens, so only ever one is open.
 * PARALLEL branches do run together, but step ids are unique across the whole
 * config, so its branches cannot hold two copies of the same id.
 */
const FANS_OUT: ReadonlySet<string> = new Set([BuiltinStepType.MAP]);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

// ─── Schema walking utilities ───

function walkSchemaPath(
  schema: z.ZodTypeAny,
  segments: string[],
): z.ZodTypeAny | null {
  if (segments.some((s) => FORBIDDEN_KEYS.has(s))) return null;

  let current: z.ZodTypeAny = schema;

  for (const segment of segments) {
    current = unwrapOptional(current);

    if (current instanceof z.ZodObject) {
      const next = (current.shape as Record<string, z.ZodTypeAny>)[segment];
      if (next) {
        current = next;
      } else {
        const def = current._def as {
          unknownKeys?: string;
          catchall?: z.ZodTypeAny;
        };
        if (def.unknownKeys === 'passthrough') {
          current = z.unknown();
        } else if (def.catchall && !(def.catchall instanceof z.ZodNever)) {
          current = def.catchall;
        } else {
          return null;
        }
      }
    } else if (current instanceof z.ZodArray) {
      if (/^\d+$/.test(segment) || segment === '*') {
        current = (current as z.ZodArray<z.ZodTypeAny>)._def.type;
      } else {
        return null;
      }
    } else if (current instanceof z.ZodRecord) {
      current = (current as z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>)._def
        .valueType;
    } else if (current instanceof z.ZodUnion) {
      const options = (
        current as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>
      )._def.options;
      const walked = walkSchemaPath(options[0]!, [segment]);
      if (!walked) return null;
      current = walked;
    } else if (current instanceof z.ZodLazy) {
      const inner = (current as z.ZodLazy<z.ZodTypeAny>)._def.getter();
      const walked = walkSchemaPath(inner, [segment]);
      if (!walked) return null;
      current = walked;
    } else {
      return null;
    }
  }

  return unwrapOptional(current);
}

function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }
  return current;
}

// ─── Type compatibility ───

const SCALAR_LIKE_ZOD_TYPES = new Set([
  'ZodString',
  'ZodNumber',
  'ZodBigInt',
  'ZodBoolean',
  'ZodDate',
  'ZodEnum',
  'ZodNativeEnum',
  'ZodLiteral',
]);

const ZOD_HUMAN_TYPE: Record<string, string> = {
  ZodString: 'text',
  ZodNumber: 'number',
  ZodBigInt: 'number',
  ZodBoolean: 'true/false',
  ZodDate: 'date',
  ZodArray: 'list',
  ZodObject: 'object',
  ZodEnum: 'option',
  ZodNativeEnum: 'option',
  ZodLiteral: 'fixed value',
  ZodUnion: 'value',
  ZodRecord: 'object',
};

function humanZodType(schema: z.ZodTypeAny): string {
  const name = schema._def.typeName as string;
  return ZOD_HUMAN_TYPE[name] ?? 'value';
}

// ─── JSON Schema walking (source / output side) ───
//
// Output sources are resolved to JSON Schema (the same `resolveOutputJsonSchema`
// the picker uses), so the validator accepts exactly the paths the picker
// offers. Path existence + type are checked against JSON Schema here.

/** Resolve anyOf/oneOf to the first variant (mirrors the zod-union handling). */
function unwrapJsonSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema) return {};
  const variants = (schema['anyOf'] ?? schema['oneOf']) as unknown[] | undefined;
  if (Array.isArray(variants) && variants[0] && typeof variants[0] === 'object') {
    return variants[0] as Record<string, unknown>;
  }
  return schema;
}

/**
 * Walk a JSON Schema down a dotted path. Returns the leaf schema; `null` if a
 * *declared* property is missing (a real typo); or a permissive `{}` for
 * freeform/dynamic nodes (no `type`, a bare `{type:'object'}`, or
 * `additionalProperties`) — those can't be statically known and resolve
 * dynamically at runtime (e.g. an HTTP `body` with no author-declared shape).
 */
function walkJsonSchemaPath(
  schema: Record<string, unknown>,
  segments: string[],
  /**
   * Treat a property access on an array as reading that property from each
   * element — JSONata's rule, and NOT the `{{ref}}` rule, so it is off by
   * default.
   *
   * `{{steps.a.output.items.amount}}` really is wrong: `resolvePath` does a
   * property lookup on the array itself and finds nothing. The same path inside
   * an expression is right, and is how anyone would write "the amounts" before
   * summing them. The two grammars genuinely differ here, so the walk has to be
   * told which one it is serving — otherwise the validator rejects every
   * correct `$sum` over a list.
   */
  mapArrays = false,
): Record<string, unknown> | null {
  if (segments.some((s) => FORBIDDEN_KEYS.has(s))) return null;

  let current = schema;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    current = unwrapJsonSchema(current);
    const type = current['type'];
    const props = current['properties'] as Record<string, Record<string, unknown>> | undefined;
    const addl = current['additionalProperties'];
    const items = current['items'] as Record<string, unknown> | undefined;

    // Freeform / "any" — nothing declared, so the remaining path is unverifiable.
    if (type === undefined && !props && addl === undefined && !items) {
      return {};
    }

    if (type === 'object' || props || addl !== undefined) {
      if (props && Object.prototype.hasOwnProperty.call(props, segment)) {
        current = props[segment]!;
        continue;
      }
      if (addl && typeof addl === 'object') {
        current = addl as Record<string, unknown>;
        continue;
      }
      // Open record (`additionalProperties: true`) or a bare object with no
      // declared properties → dynamic at runtime, accept the rest.
      if (addl === true || !props) return {};
      return null; // declared properties, but `segment` isn't one of them
    }

    if (type === 'array') {
      if (/^\d+$/.test(segment) || segment === '*') {
        current = items ?? {};
        continue;
      }
      // Re-read this same segment against the element schema; an array with no
      // declared `items` has unknown elements, so the rest is unverifiable.
      if (mapArrays) {
        return items ? walkJsonSchemaPath(items, segments.slice(i), true) : {};
      }
      return null;
    }

    // Scalar with a further segment — can't index into it.
    return null;
  }
  return unwrapJsonSchema(current);
}

/**
 * What a reference inside an expression evaluates to, including whether it is a
 * *list* of that thing.
 *
 * Separate from {@link walkJsonSchemaPath} because the two answer different
 * questions. That one asks "does this path exist", and returns the leaf. This
 * asks "what will JSONata hand back", and the difference is the array step:
 * `items.amount` over a list of objects does not give a number, it gives a
 * number for *each* item — so the type is a list of numbers, which is exactly
 * what makes `$sum` of it legal and `$round` of it not.
 *
 * `undefined` means "cannot be read", never "wrong": a freeform node, an
 * undeclared property, a path through something scalar. The caller turns that
 * into `unknown`, which checks nothing.
 */
/** How many nested lists a single path step will be followed through. */
const MAX_SCHEMA_DEPTH = 10;

function expressionPathType(
  schema: Record<string, unknown>,
  segments: readonly string[],
): ExprType | undefined {
  if (segments.some((segment) => FORBIDDEN_KEYS.has(segment))) return undefined;

  let current = schema;
  /** Set once the path steps through a list, because results then come as one. */
  let mapped = false;

  for (const segment of segments) {
    // Step through any number of nested lists before looking for the segment:
    // in JSONata a property access reaches the elements, however deep the
    // nesting goes. Bounded so that a self-referential schema cannot spin.
    for (let unwrapped = 0; unwrapped < MAX_SCHEMA_DEPTH; unwrapped++) {
      current = unwrapJsonSchema(current);
      if (current['type'] !== 'array') break;
      const items = current['items'] as Record<string, unknown> | undefined;
      if (!items) return undefined; // elements never declared
      mapped = true;
      current = items;
    }

    const props = current['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (!props || !Object.prototype.hasOwnProperty.call(props, segment)) {
      return undefined; // freeform, open record, or simply not declared
    }
    current = props[segment]!;
  }

  const leaf = unwrapJsonSchema(current);
  const leafItems = leaf['items'] as Record<string, unknown> | undefined;
  const type: ExprType =
    jsonSchemaKind(leaf) === 'array'
      ? { array: leafItems ? jsonSchemaKind(unwrapJsonSchema(leafItems)) : 'unknown' }
      : jsonSchemaKind(leaf);

  // A list of lists is flattened by JSONata, so mapping an already-list leaf
  // changes nothing.
  return mapped && baseKind(type) !== 'array' ? { array: type } : type;
}

/** Coarse kind of a JSON-schema leaf, for loose type compatibility. */
/**
 * A schema node's kind. The rule lives in {@link kindOfJsonType}; this is the
 * node-shaped way to ask it, which is what a schema walk has in hand.
 */
function jsonSchemaKind(schema: Record<string, unknown>): TypeKind {
  const declared = schema['type'];
  return kindOfJsonType(typeof declared === 'string' ? declared : undefined);
}

const JSON_HUMAN_TYPE: Record<string, string> = {
  string: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'true/false',
  array: 'list',
  object: 'object',
};
function humanJsonType(schema: Record<string, unknown>): string {
  const t = schema['type'];
  return (typeof t === 'string' && JSON_HUMAN_TYPE[t]) || 'value';
}

/** Coarse kind of a consumer zod schema, for loose type compatibility. */
function zodConsumerKind(schema: z.ZodTypeAny): TypeKind {
  const name = schema._def.typeName as string;
  if (name === 'ZodString') return 'string';
  if (name === 'ZodNumber' || name === 'ZodBigInt') return 'number';
  if (name === 'ZodBoolean') return 'boolean';
  if (name === 'ZodArray') return 'array';
  if (name === 'ZodObject' || name === 'ZodRecord') return 'object';
  if (name === 'ZodUnknown' || name === 'ZodAny') return 'unknown';
  if (SCALAR_LIKE_ZOD_TYPES.has(name)) return 'scalar';
  return 'unknown';
}

/**
 * Is a JSON-schema source leaf compatible with the consumer field's zod type?
 * Delegates to the shared `kindsCompatible` rule so the validator and the
 * builder's variable picker can never drift.
 */
function sourceConsumerCompatible(
  sourceLeaf: Record<string, unknown>,
  consumer: z.ZodTypeAny,
): boolean {
  return kindsCompatible(jsonSchemaKind(sourceLeaf), zodConsumerKind(consumer));
}

/** Strip a `${stepPath}.config` prefix off a ref location → the field path within the step config. */
function stripPrefix(location: string, prefix: string): string {
  if (location === prefix) return '';
  if (location.startsWith(prefix + '.')) return location.slice(prefix.length + 1);
  if (location.startsWith(prefix + '[')) return location.slice(prefix.length);
  return location;
}

/** Build a step-scoped issue location, omitting `field` when the ref sits at the config root. */
function stepRefLocation(
  stepId: string,
  prefix: string,
  location: string,
): ValidationIssueLocation {
  const field = stripPrefix(location, prefix);
  return field ? { scope: 'step', stepId, field } : { scope: 'step', stepId };
}

/** A control-flow step around the steps being walked (outermost first), for checking jumps. */
interface EnclosingStep {
  id: string;
  type: string;
  impl: BaseControlFlowStep<z.ZodTypeAny, Record<string, unknown>>;
  config: Record<string, unknown>;
}

// ─── ConfigValidator ───

/**
 * Validates a complete WorkflowConfig against registered triggers and steps.
 *
 * Checks:
 * 1. Trigger type is registered + config validates against trigger schema
 * 2. Step types are registered + configs validate against step schemas
 * 3. Variable references (`{{...}}`) are resolvable (not forward refs, path exists)
 * 4. Type compatibility between ref source and consumer schema
 * 5. Control-flow branches are recursively validated via `getBranches()`
 */
export class ConfigValidator {
  constructor(
    private readonly connectors: ConnectorRegistry,
  ) {}

  /**
   * Every component in the tree, nested branches included, with the path its
   * config sits at.
   *
   * Pure and synchronous, like the rest of this class: it says WHAT is there,
   * so a caller that does have credentials and a caller can ask each component
   * about the world. Keeping that split is the point — a validator that
   * resolved credentials and made network calls would stop being a validator.
   *
   * Paths match what {@link validate} produces, so an issue a component returns
   * lands in the same place as a shape issue: `steps[0].config.body[2].config`.
   */
  components(config: WorkflowConfig): ComponentRef[] {
    const found: ComponentRef[] = [];
    if (this.connectors.hasTrigger(config.trigger.type)) {
      found.push({
        kind: 'trigger',
        type: config.trigger.type,
        path: 'trigger.config',
        config: (config.trigger.config ?? {}) as Record<string, unknown>,
      });
    }
    this.collectSteps(config.steps, 'steps', found);
    return found;
  }

  private collectSteps(
    steps: WorkflowStepConfig[],
    prefix: string,
    found: ComponentRef[],
  ): void {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i]!;
      const stepPath = `${prefix}[${String(i)}]`;
      if (!this.connectors.hasStep(step.type)) continue;

      const stepImpl = this.connectors.getStep(step.type);
      const stepConfig = (step.config ?? {}) as Record<string, unknown>;
      found.push({
        kind: 'step',
        type: step.type,
        path: `${stepPath}.config`,
        config: stepConfig,
        stepId: step.id,
      });

      // A control-flow step's branches hold steps of their own — the same
      // recursion `walkSteps` does, so the paths agree.
      const branches =
        stepImpl instanceof BaseControlFlowStep && stepImpl.getBranches
          ? stepImpl.getBranches(stepConfig)
          : undefined;
      if (!branches) continue;
      for (const [branchKey, branchSteps] of Object.entries(branches)) {
        this.collectSteps(branchSteps, `${stepPath}.config.${branchKey}`, found);
      }
    }
  }

  validate(config: WorkflowConfig): ValidationResult {
    const issues: ValidationIssue[] = [];
    // Source schemas are JSON Schema, resolved exactly like the variable picker
    // (`resolveOutputJsonSchema`), so validation accepts what the picker offers.
    const outputSchemas = new Map<string, Record<string, unknown>>();

    // --- Variables (author-time constants) ---
    // Registered before the trigger is validated because a start anchor may read
    // either source, and unconditionally so a `{{vars.x}}` ref when nothing is
    // declared reads as an unknown-key error, not a confusing forward reference.
    outputSchemas.set('vars', varsJsonSchema(config.variables));

    // --- Trigger validation ---
    if (config.trigger) {
      if (!this.connectors.hasTrigger(config.trigger.type)) {
        issues.push({
          path: 'trigger.type',
          code: ValidationIssueCode.SHAPE,
          message: `Unknown trigger type "${config.trigger.type}". Is it registered?`,
          location: { scope: 'trigger' },
        });
      } else {
        const triggerImpl = this.connectors.getTrigger(config.trigger.type);
        const result = triggerImpl.configSchema.safeParse(
          config.trigger.config,
        );
        if (!result.success) {
          for (const issue of result.error.issues) {
            issues.push({
              path: `trigger.config.${issue.path.join('.')}`,
              code: ValidationIssueCode.SHAPE,
              message: issue.message,
              location: { scope: 'trigger', field: issue.path.join('.') },
            });
          }
        }
        this.checkCredentialSlots(
          triggerImpl.credentialSlots,
          config.trigger.config,
          'trigger.config',
          { scope: 'trigger' },
          issues,
        );
        outputSchemas.set(
          'trigger',
          resolveOutputJsonSchemaOf(
            triggerImpl,
            (config.trigger.config ?? {}) as Record<string, unknown>,
          ),
        );
      }
      this.validateTriggerFilter(config.trigger.filter, outputSchemas, issues);
      this.validateTriggerStart(config.trigger.start, outputSchemas, issues);
    }

    // --- Steps validation ---
    const seenIds = new Set<string>();
    this.walkSteps(config.steps, 'steps', outputSchemas, issues, seenIds);

    return { valid: issues.length === 0, issues };
  }

  private walkSteps(
    steps: WorkflowStepConfig[],
    prefix: string,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    seenIds: Set<string>,
    enclosing: readonly EnclosingStep[] = [],
  ): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const stepPath = `${prefix}[${i}]`;

      // Check for duplicate step IDs across the entire config tree
      if (seenIds.has(step.id)) {
        issues.push({
          path: `${stepPath}.id`,
          code: ValidationIssueCode.DUPLICATE_STEP_ID,
          message: `Duplicate step ID "${step.id}". Step IDs must be unique across the entire workflow, including nested branches.`,
          location: { scope: 'step', stepId: step.id },
        });
      }
      seenIds.add(step.id);

      // An API call is addressed by the author's step id, and a MAP parks one
      // node per item under that id — so the caller could not say which it
      // meant. Said here, at authoring time, rather than as an ambiguous
      // delivery when the callback finally arrives.
      if (step.type === BuiltinStepType.WAIT_FOR_WEBHOOK) {
        const fan = enclosing.find((e) => FANS_OUT.has(e.type));
        if (fan) {
          issues.push({
            path: `${stepPath}.type`,
            code: ValidationIssueCode.MISCONFIGURED,
            message:
              `"${step.id}" waits for a webhook inside "${fan.id}" (${fan.type}), which runs its steps for every item at once. `
              + 'The caller addresses this wait by its step id, and that would name one waiting copy per item. '
              + 'Move the wait outside, or start a run per item so each has a wait of its own.',
            location: { scope: 'step', stepId: step.id },
          });
        }
      }

      if (!this.connectors.hasStep(step.type)) {
        issues.push({
          path: `${stepPath}.type`,
          code: ValidationIssueCode.SHAPE,
          message: `Unknown step type "${step.type}". Is it registered?`,
          location: { scope: 'step', stepId: step.id },
        });
        continue;
      }

      const stepImpl = this.connectors.getStep(step.type);
      const stepConfig = step.config as Record<string, unknown>;

      const shapeResult = stepImpl.configSchema.safeParse(step.config);
      if (!shapeResult.success) {
        for (const issue of shapeResult.error.issues) {
          issues.push({
            path: `${stepPath}.config.${issue.path.join('.')}`,
            code: ValidationIssueCode.SHAPE,
            message: issue.message,
            location: { scope: 'step', stepId: step.id, field: issue.path.join('.') },
          });
        }
      }

      this.checkCredentialSlots(
        stepImpl.credentialSlots,
        step.config as Record<string, unknown> | undefined,
        `${stepPath}.config`,
        { scope: 'step', stepId: step.id },
        issues,
      );

      // A control-flow step's branches hold steps of their own, checked below in
      // their own scope — so its ref check covers only the step's own fields.
      const branches =
        stepImpl instanceof BaseControlFlowStep && stepImpl.getBranches
          ? stepImpl.getBranches(stepConfig)
          : undefined;

      // Ref and expression validation for the step's own config. A control
      // step's branch arrays are left out of both — their steps are checked in
      // their own scope, where the refs visible to them are known.
      const ownScopeOnly = branches
        ? new Set<unknown>(Object.values(branches))
        : undefined;

      this.validateRefs(
        stepConfig,
        `${stepPath}.config`,
        stepImpl.configSchema,
        outputSchemas,
        issues,
        step.id,
        ownScopeOnly,
      );

      this.validateExpressions(
        stepConfig,
        `${stepPath}.config`,
        stepImpl.configSchema,
        outputSchemas,
        issues,
        step.id,
        ownScopeOnly,
      );

      this.validateConditions(
        stepConfig,
        `${stepPath}.config`,
        { scope: 'step', stepId: step.id },
        outputSchemas,
        issues,
        ownScopeOnly,
      );

      if (isJumpingStep(stepImpl)) {
        this.validateJump(step, stepPath, stepImpl.jumpKind, enclosing, issues);
      }

      // Register this step's input + output schemas (JSON Schema, resolved like
      // the picker so refs into dynamic outputs — e.g. HTTP body — line up).
      outputSchemas.set(`${step.id}.input`, zodToJsonSchemaRecord(stepImpl.configSchema));
      outputSchemas.set(
        `${step.id}.output`,
        resolveOutputJsonSchemaOf(stepImpl, stepConfig, this.connectors),
      );

      // Author citations (documentation overlay) — validate target field + ref.
      this.validateCitations(step, stepPath, outputSchemas, issues);

      // Control-flow branches, each walked with the refs visible before the step
      // plus whatever the step exposes inside them (e.g. a loop's `__loop`).
      if (stepImpl instanceof BaseControlFlowStep && branches) {
        const scope = stepImpl.branchScopeSchemas?.(stepConfig) ?? {};
        const inner: EnclosingStep[] = [
          ...enclosing,
          { id: step.id, type: step.type, impl: stepImpl, config: stepConfig },
        ];
        for (const [branchKey, branchSteps] of Object.entries(branches)) {
          const branchSchemas = new Map(outputSchemas);
          for (const [key, schema] of Object.entries(scope)) {
            branchSchemas.set(key, schema);
          }
          this.walkSteps(
            branchSteps,
            `${stepPath}.config.${branchKey}`,
            branchSchemas,
            issues,
            seenIds,
            inner,
          );
        }
      }
    }
  }

  /**
   * A required credential slot left empty. Reported once per field: a field the
   * config schema already rejected keeps that issue instead.
   */
  private checkCredentialSlots(
    slots: readonly CredentialSlot[] | undefined,
    config: Record<string, unknown> | undefined,
    pathPrefix: string,
    location: ValidationIssueLocation,
    issues: ValidationIssue[],
  ): void {
    for (const slot of slots ?? []) {
      if (!slot.required) continue;
      const value = config?.[slot.name];
      if (value !== undefined && value !== null && value !== '') continue;
      const alreadyReported = issues.some(
        (issue) =>
          issue.location?.scope === location.scope &&
          issue.location.stepId === location.stepId &&
          issue.location.field === slot.name,
      );
      if (alreadyReported) continue;
      issues.push({
        path: `${pathPrefix}.${slot.name}`,
        code: ValidationIssueCode.MISSING_CREDENTIAL,
        message: 'Select a credential',
        location: { ...location, field: slot.name },
      });
    }
  }

  /**
   * A start policy has to be well formed before it is saved, and its anchor has to
   * name a field that exists.
   *
   * Both failures are invisible at runtime by design — an anchor that resolves to
   * nothing arms no run and leaves no trace — so they are caught here instead.
   */
  private validateTriggerStart(
    start: WorkflowConfig['trigger']['start'],
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
  ): void {
    if (start === undefined) return;
    const location: ValidationIssueLocation = { scope: 'trigger', field: 'start' };
    const parsed = TriggerStartSchema.safeParse(start);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          path: ['trigger.start', ...issue.path].join('.'),
          code: ValidationIssueCode.SHAPE,
          message: issue.message,
          location,
        });
      }
      return;
    }
    if (parsed.data.kind !== 'at') return;

    // Worked out rather than read. `readAnchor` resolves an expression here, so
    // it gets the same reading as one anywhere else — including whether what it
    // produces can be a moment in time.
    const computed = extractExpressionSource(parsed.data.anchor);
    if (computed !== null) {
      // No consumer schema: the anchor is declared `z.string()`, and text is the
      // universal sink, so a generic field check here would accept everything.
      // The real rule is the one below, which is the same one the reference
      // branch applies.
      const produced = this.checkExpression(
        computed,
        'trigger.start.anchor',
        location,
        outputSchemas,
        issues,
        null,
      );
      const kind = baseKind(produced);
      if (kind === 'boolean' || kind === 'object' || kind === 'array') {
        issues.push({
          path: 'trigger.start.anchor',
          code: ValidationIssueCode.TYPE_MISMATCH,
          message: `{% ${computed} %} gives ${sayType(produced)}, which cannot be a date and time.`,
          location,
        });
      }
      // The same confinement the schema puts on a plain reference, extended to
      // every reference inside the expression: before a run there is nothing
      // but the event and the workflow's variables.
      for (const refPath of refsInExpression(computed)) {
        const head = refPath.split('.')[0];
        if (head !== 'trigger' && head !== 'vars') {
          issues.push({
            path: 'trigger.start.anchor',
            code: ValidationIssueCode.SHAPE,
            message: `An anchor can only read trigger data or a workflow variable, not "${refPath}"`,
            location,
          });
        }
      }
      return;
    }

    // A literal timestamp passes the schema above and has nothing to resolve;
    // checkRef ignores anything that is not a reference.
    const before = issues.length;
    this.checkRef(
      parsed.data.anchor,
      'trigger.start.anchor',
      outputSchemas,
      issues,
      AnchorValueSchema,
      location,
    );
    if (issues.length > before) return;

    // `checkRef` treats text as the universal sink — every kind coerces into it —
    // which is right for a message body and wrong for a moment in time. A list or
    // an object can never be one, so say so here rather than let the rule arm
    // nothing at runtime. Text that is not a date still passes: without the source
    // declaring a date format there is nothing to check it against.
    const refPath = extractRefPath(parsed.data.anchor);
    if (!refPath) return;
    const [head, ...rest] = refPath.split('.');
    const sourceSchema = head === undefined ? undefined : outputSchemas.get(head);
    if (!sourceSchema) return;
    const leaf = walkJsonSchemaPath(sourceSchema, rest);
    const leafKind = leaf === null ? 'unknown' : jsonSchemaKind(leaf);
    if (leafKind === 'boolean' || leafKind === 'object' || leafKind === 'array') {
      issues.push({
        path: 'trigger.start.anchor',
        code: ValidationIssueCode.TYPE_MISMATCH,
        message: `"${parsed.data.anchor}" is ${humanJsonType(leaf ?? {})}, which cannot be a date and time.`,
        location,
      });
    }
  }

  /**
   * A trigger filter must be well formed, and may only read what exists before
   * a run: the trigger's output and workflow variables.
   */
  private validateTriggerFilter(
    filter: TriggerFilter | undefined,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
  ): void {
    if (filter === undefined) return;
    const location: ValidationIssueLocation = { scope: 'trigger', field: 'filter' };
    const parsed = TriggerFilterSchema.safeParse(filter);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          path: ['trigger.filter', ...issue.path].join('.'),
          code: ValidationIssueCode.INVALID_FILTER,
          message: issue.message,
          location,
        });
      }
      return;
    }
    const visit = (condition: Condition, path: string): void => {
      if ('all' in condition) {
        condition.all.forEach((child, i) => visit(child, `${path}.all[${i}]`));
        return;
      }
      if ('any' in condition) {
        condition.any.forEach((child, i) => visit(child, `${path}.any[${i}]`));
        return;
      }
      /**
       * A filter may only read what exists before a run — the event's payload
       * and the workflow's variables. There are no step outputs yet.
       *
       * Enforced over *every* reference rather than just the leading one, so
       * that an expression cannot reach further than a plain reference can.
       */
      const confine = (refPath: string, said: string): void => {
        const head = refPath.split('.')[0];
        if (head !== 'trigger' && head !== 'vars') {
          issues.push({
            path: `${path}.variable`,
            code: ValidationIssueCode.INVALID_FILTER,
            message: `Filters can only use trigger data and workflow variables, not "${said}"`,
            location,
          });
        }
      };

      // Something worked out, rather than read. The schema accepts one here and
      // `ConditionEvaluator` evaluates it, so refusing it as "no value chosen"
      // — which is what reading it as a reference used to do — was wrong.
      const computed = extractExpressionSource(condition.variable);
      if (computed !== null) {
        this.checkExpression(
          computed,
          `${path}.variable`,
          location,
          outputSchemas,
          issues,
          null,
        );
        for (const refPath of refsInExpression(computed)) confine(refPath, refPath);
        return;
      }

      const refPath = extractRefPath(condition.variable);
      if (!refPath) {
        issues.push({
          path: `${path}.variable`,
          code: ValidationIssueCode.INVALID_FILTER,
          message: 'Choose a value for every filter condition',
          location,
        });
        return;
      }
      confine(refPath, `{{${refPath}}}`);
    };
    if (parsed.data.conditions) {
      visit(parsed.data.conditions, 'trigger.filter.conditions');
      // The same reading a step's conditions get: an operator that can never
      // hold is a filter that can never admit anything.
      this.validateConditions(
        parsed.data.conditions,
        'trigger.filter.conditions',
        location,
        outputSchemas,
        issues,
      );
    }
  }

  /**
   * A GO_TO/FINISH must name a step around it that catches jumps
   * (`jumps: 'catch'` — CYCLE is the only built-in that does), must not leave a
   * concurrently-run branch on the way (`jumps: 'block'`), and must carry what
   * that loop expects (`checkJump`).
   */
  private validateJump(
    step: WorkflowStepConfig,
    stepPath: string,
    kind: JumpKind,
    enclosing: readonly EnclosingStep[],
    issues: ValidationIssue[],
  ): void {
    const config = step.config as Record<string, unknown>;
    const target = config['target'];
    // A missing target is already reported as a shape issue.
    if (typeof target !== 'string' || target.length === 0) return;

    const label = kind === 'goto' ? 'GO_TO' : 'FINISH';
    const report = (field: string, message: string): void => {
      issues.push({
        path: `${stepPath}.config.${field}`,
        code: ValidationIssueCode.INVALID_JUMP,
        message,
        location: { scope: 'step', stepId: step.id, field },
      });
    };

    let index = enclosing.length - 1;
    while (index >= 0 && enclosing[index]!.id !== target) index--;
    const owner = enclosing[index];
    if (!owner) {
      report('target', `${label} targets "${target}", which doesn't contain step "${step.id}". Choose a CYCLE around it.`);
      return;
    }
    if (owner.impl.jumps !== 'catch') {
      report('target', `${label} can't target "${target}": a ${owner.type} doesn't catch jumps. Choose a CYCLE around step "${step.id}".`);
      return;
    }
    const blocker = enclosing.slice(index + 1).find((e) => e.impl.jumps === 'block');
    if (blocker) {
      report('target', `${label} can't leave "${blocker.id}": a ${blocker.type} runs its branches at the same time.`);
      return;
    }
    const problem = owner.impl.checkJump?.(owner.config, { kind, value: config['with'] });
    if (problem) report('with', problem);
  }

  /**
   * Validate a step's author citations (documentation overlay):
   * - the cited field path must address a real field in `config`;
   * - each citation `ref` must be a resolvable reference (no type constraint —
   *   citations may point at any value or attachment).
   * Non-blocking by nature (uses the same reference issue codes).
   */
  private validateCitations(
    step: WorkflowStepConfig,
    stepPath: string,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
  ): void {
    const citations = (step as { citations?: Record<string, Citation[]> }).citations;
    if (!citations) return;
    const stepConfig = step.config as Record<string, unknown>;

    for (const [fieldPath, list] of Object.entries(citations)) {
      if (resolveCitationPath(stepConfig, fieldPath) === undefined) {
        issues.push({
          path: `${stepPath}.citations.${fieldPath}`,
          code: ValidationIssueCode.UNKNOWN_REFERENCE,
          message: `Citation targets field "${fieldPath}" which does not exist in step "${step.id}".`,
          location: { scope: 'step', stepId: step.id, field: fieldPath },
        });
      }
      list.forEach((citation, i) => {
        if (typeof citation?.ref !== 'string' || citation.ref.length === 0) return;
        // null consumer schema → ref existence/forward-ref only, no type check.
        this.checkRef(
          citation.ref,
          `${stepPath}.citations.${fieldPath}[${String(i)}].ref`,
          outputSchemas,
          issues,
          null,
          { scope: 'step', stepId: step.id, field: fieldPath },
        );
        // Optional pageNumber: only a `{{...}}` reference needs validation;
        // a literal (e.g. "3") is left as-is.
        if (typeof citation.pageNumber === 'string' && isPureRef(citation.pageNumber)) {
          this.checkRef(
            citation.pageNumber,
            `${stepPath}.citations.${fieldPath}[${String(i)}].pageNumber`,
            outputSchemas,
            issues,
            null,
            { scope: 'step', stepId: step.id, field: fieldPath },
          );
        }
      });
    }
  }

  private validateRefs(
    config: Record<string, unknown>,
    prefix: string,
    configSchema: z.ZodTypeAny,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    stepId: string,
    /** Branch step arrays to leave out — their steps are checked in their own scope. */
    skip?: ReadonlySet<unknown>,
  ): void {
    for (const { refPath, location } of collectRefs(config, prefix, skip)) {
      const consumerInner = this.getConsumerInnerSchema(
        configSchema,
        location,
        prefix,
      );
      this.checkRef(
        `{{context.${refPath}}}`,
        location,
        outputSchemas,
        issues,
        consumerInner,
        // Resolved location: step + field path relative to the step's config.
        stepRefLocation(stepId, prefix, location),
      );
    }
  }

  /**
   * Expressions in a step's own config: can they be read, may they run, and do
   * the references inside them lead anywhere.
   *
   * Three checks, in the order that makes the *first* message the useful one —
   * there is no point reporting an unknown reference inside an expression that
   * does not parse.
   */
  /**
   * A reference's type, as an expression sees it.
   *
   * Only the explicit roots: inside `{% … %}` there is no bare-step shorthand,
   * which is what makes a leading name unambiguous there. `workflow` and
   * `execution` describe nothing, so they read as unknown — same as a `{{ref}}`
   * into them is left unchecked.
   */
  private expressionTypes(
    outputSchemas: Map<string, Record<string, unknown>>,
  ): (path: string) => ExprType | undefined {
    return (path: string): ExprType | undefined => {
      const segments = path.split('.').filter((segment) => segment.length > 0);
      const head = segments[0];

      if (head === 'trigger') {
        const schema = outputSchemas.get('trigger');
        return schema ? expressionPathType(schema, segments.slice(1)) : undefined;
      }
      if (head === 'vars') {
        const schema = outputSchemas.get('vars');
        return schema ? expressionPathType(schema, segments.slice(1)) : undefined;
      }
      if (head === 'steps') {
        const stepId = segments[1];
        if (!stepId) return undefined;
        const role = segments[2];
        const addressed = role === 'input' || role === 'output';
        const schema = outputSchemas.get(addressed ? `${stepId}.${role}` : `${stepId}.output`);
        return schema
          ? expressionPathType(schema, segments.slice(addressed ? 3 : 2))
          : undefined;
      }
      return undefined;
    };
  }

  /**
   * Every check that applies to one expression, wherever it sits.
   *
   * One method rather than one per surface, because "is this expression valid"
   * must not have two answers. It was a per-step walk first, which left the
   * trigger's filter and its delayed-start anchor evaluating expressions that
   * nothing had read — no syntax check, no ban on naming a function, no types.
   *
   * `consumer` is the Zod schema the result is bound into, or null where there
   * is nothing to bind to (a condition's own slot, a reference inside another
   * expression).
   *
   * Returns what the expression produces, so a caller with a rule of its own can
   * apply it — a delayed start, for instance, knows that a list can never be a
   * moment in time, which no schema of `z.string()` will ever say.
   */
  private checkExpression(
    source: string,
    path: string,
    location: ValidationIssueLocation,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    consumer: z.ZodTypeAny | null,
  ): ExprType {
    const fault = inspectExpression(source);
    if (fault) {
      issues.push({
        path,
        code: ValidationIssueCode.INVALID_EXPRESSION,
        message: `{% ${source} %} — ${fault.message}`,
        location,
      });
      return 'unknown';
    }

    // Existence and ordering of each reference — note the `null` consumer
    // schema passed on. A reference inside an expression is NOT bound to the
    // field: the expression transforms it, so `$sum` over a list of numbers
    // belongs in a number field even though the list does not. Whether the
    // *result* fits is a separate question, answered below.
    for (const refPath of refsInExpression(source)) {
      this.checkRef(
        `{{context.${refPath}}}`,
        path,
        outputSchemas,
        issues,
        null,
        location,
        source,
      );
    }

    // What the expression produces, and what it misuses getting there. This is
    // what makes the typing promise hold *before* a run: without it the engine
    // leans on JSONata's own signature errors and on zod rejecting the result,
    // which are both correct and both too late to help anyone writing.
    const { type, faults } = inferExpressionType(source, this.expressionTypes(outputSchemas));

    for (const typeFault of faults) {
      issues.push({
        path,
        code: ValidationIssueCode.TYPE_MISMATCH,
        message: `{% ${source} %} — ${typeFault.message}`,
        location,
      });
    }

    // Only when the inside is sound: one mistake should be reported once, and a
    // bad argument already explains the wrong result.
    if (faults.length === 0 && consumer !== null) {
      if (!assignableToField(type, zodConsumerKind(consumer))) {
        issues.push({
          path,
          code: ValidationIssueCode.TYPE_MISMATCH,
          message: `{% ${source} %} gives ${sayType(type)}, but this field expects a ${humanZodType(consumer)}.`,
          location,
        });
      }
    }
    return type;
  }

  /** Every expression in a step's own config, checked where it sits. */
  private validateExpressions(
    config: Record<string, unknown>,
    prefix: string,
    configSchema: z.ZodTypeAny,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    stepId: string,
    skip?: ReadonlySet<unknown>,
  ): void {
    // Conditions included — a condition's own slots accept an expression, which
    // `ConditionEvaluator` resolves.
    for (const { source, location } of collectExpressions(config, prefix, skip)) {
      this.checkExpression(
        source,
        location,
        stepRefLocation(stepId, prefix, location),
        outputSchemas,
        issues,
        this.getConsumerInnerSchema(configSchema, location, prefix),
      );
    }
  }

  /**
   * What a condition's left side will produce, as far as can be told.
   *
   * An expression's type is computed; a reference's is read from the schema. A
   * literal cannot appear here — the schema accepts only the two.
   */
  private conditionVariableType(
    variable: string,
    outputSchemas: Map<string, Record<string, unknown>>,
  ): ExprType {
    const lookup = this.expressionTypes(outputSchemas);
    const computed = extractExpressionSource(variable);
    if (computed !== null) return inferExpressionType(computed, lookup).type;
    const refPath = extractRefPath(variable);
    return refPath === null ? 'unknown' : (lookup(refPath) ?? 'unknown');
  }

  /**
   * One condition leaf: can its operator hold against what is on the left?
   *
   * Only where the operator is unambiguous about it — see `needs` on
   * `OperatorDescriptor`. "is greater than" against text, or "starts with"
   * against a number, is not a near miss: the comparison can never be true, so
   * the branch is unreachable and the author almost certainly meant something
   * else.
   *
   * Deliberately *not* checked: the comparison value against the left side.
   * `looseEquals` coerces on purpose — `5` equals `"5"` here — so refusing a
   * number against text would refuse something that works.
   */
  private checkConditionLeaf(
    leaf: LeafCondition,
    path: string,
    location: ValidationIssueLocation,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
  ): void {
    const descriptor = OPERATOR_DESCRIPTORS.find((entry) => entry.value === leaf.operator);
    const needs = descriptor?.needs;
    if (descriptor === undefined || needs === undefined) return;

    const type = this.conditionVariableType(leaf.variable, outputSchemas);
    if (assignableToArgument(type, needs)) return;
    issues.push({
      path: `${path}.variable`,
      code: ValidationIssueCode.TYPE_MISMATCH,
      message: `"${descriptor.label}" needs ${sayType(needs)}, but this is ${sayType(type)} — the condition can never be true.`,
      location,
    });
  }

  /**
   * Every condition leaf reachable in a value.
   *
   * Conditions are found structurally, by the same predicate the resolver and
   * the expression pre-pass use, so the three cannot disagree about what one is.
   */
  private validateConditions(
    value: unknown,
    prefix: string,
    location: ValidationIssueLocation,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    skip?: ReadonlySet<unknown>,
  ): void {
    const walk = (node: unknown, path: string): void => {
      if (skip?.has(node)) return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;

      if (isCondition(record)) {
        for (const join of ['all', 'any'] as const) {
          const parts = record[join];
          if (Array.isArray(parts)) {
            parts.forEach((part, index) => walk(part, `${path}.${join}[${index}]`));
            return;
          }
        }
        this.checkConditionLeaf(
          record as unknown as LeafCondition,
          path,
          location,
          outputSchemas,
          issues,
        );
        return;
      }
      for (const [key, child] of Object.entries(record)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    };
    walk(value, prefix);
  }

  private checkRef(
    refString: string,
    location: string,
    outputSchemas: Map<string, Record<string, unknown>>,
    issues: ValidationIssue[],
    consumerInnerSchema: z.ZodTypeAny | null,
    issueLocation: ValidationIssueLocation,
    /**
     * The expression this reference came out of, when it did.
     *
     * One parameter rather than two flags, because both differences it causes
     * have the same cause: a path inside an expression maps over arrays, and
     * the author never wrote `{{context....}}`, so quoting it back at them
     * would be a riddle. Callers pass the reference in `{{...}}` form either
     * way so that the parsing below stays single-form.
     */
    expression?: string,
  ): void {
    const inner = refString.match(/^\{\{(?:context\.)?([^}]+)\}\}$/);
    if (!inner?.[1]) return;

    const refPath = inner[1];
    const display =
      expression !== undefined ? `"${refPath}" in {% ${expression} %}` : `"${refString}"`;
    const segments = refPath.split('.');
    const sourceKey = segments[0];
    if (!sourceKey) return;

    let resolverKey: string;
    let pathSegments: string[];

    if (sourceKey === 'trigger') {
      resolverKey = 'trigger';
      pathSegments = segments.slice(1);
    } else if (sourceKey === 'workflow' || sourceKey === 'execution') {
      // workflow.id, workflow.metadata.x, execution.id — not validatable against output schemas
      return;
    } else if (sourceKey === 'steps') {
      // Explicit: steps.stepId.output.field
      const stepId = segments[1];
      const role = segments[2];
      if (!stepId) return;
      if (role === 'input' || role === 'output') {
        resolverKey = `${stepId}.${role}`;
        pathSegments = segments.slice(3);
      } else {
        resolverKey = `${stepId}.output`;
        pathSegments = segments.slice(2);
      }
    } else if (sourceKey === 'vars') {
      // {{vars.<key>}} — validate the KEY is declared. The sub-path drills into
      // author-shaped JSON or an attachment's internals, which we deliberately
      // don't enumerate, so we stop at the key (like `workflow.*`).
      const key = segments[1];
      const declared = outputSchemas.get('vars');
      const props =
        (declared?.['properties'] as Record<string, unknown> | undefined) ?? {};
      if (!key || !(key in props)) {
        issues.push({
          path: location,
          code: ValidationIssueCode.UNKNOWN_REFERENCE,
          message: `${display} references an undeclared workflow variable "vars.${key ?? ''}". Declare it in the workflow's Variables.`,
          location: issueLocation,
        });
      }
      return;
    } else {
      // Shorthand: stepId.output.field or stepId.field
      const role = segments[1];
      if (role === 'input' || role === 'output') {
        resolverKey = `${sourceKey}.${role}`;
        pathSegments = segments.slice(2);
      } else {
        resolverKey = `${sourceKey}.output`;
        pathSegments = segments.slice(1);
      }
    }

    if (!outputSchemas.has(resolverKey)) {
      issues.push({
        path: location,
        code: ValidationIssueCode.FORWARD_REFERENCE,
        message: `${display} references "${sourceKey}" which is not yet available at this point in the workflow (forward reference, or unknown step / trigger ID).`,
        location: issueLocation,
      });
      return;
    }

    const sourceSchema = outputSchemas.get(resolverKey)!;
    const leafSchema = walkJsonSchemaPath(sourceSchema, pathSegments, expression !== undefined);

    if (leafSchema === null) {
      issues.push({
        path: location,
        code: ValidationIssueCode.UNKNOWN_REFERENCE,
        message: `${display} — path "${pathSegments.join('.')}" does not exist in the schema of "${resolverKey}".`,
        location: issueLocation,
      });
      return;
    }

    if (consumerInnerSchema !== null) {
      if (!sourceConsumerCompatible(leafSchema, consumerInnerSchema)) {
        issues.push({
          path: location,
          code: ValidationIssueCode.TYPE_MISMATCH,
          message: `${display} is a ${humanJsonType(leafSchema)} but this field expects a ${humanZodType(consumerInnerSchema)}.`,
          location: issueLocation,
        });
      }
    }
  }

  private getConsumerInnerSchema(
    configSchema: z.ZodTypeAny,
    location: string,
    prefix: string,
  ): z.ZodTypeAny | null {
    const relative = location.startsWith(prefix + '.')
      ? location.slice(prefix.length + 1)
      : location.slice(prefix.length);
    if (!relative) return null;

    const segments = relative
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);

    const leafSchema = walkSchemaPath(configSchema, segments);
    if (!leafSchema) return null;
    return getVariableRefInnerSchema(leafSchema);
  }
}
