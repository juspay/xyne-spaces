import { z } from 'zod';
import type {
  AutomationConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
  Condition,
} from '../types/automation-config';
import { getVariableRefInnerSchema } from '../types/automation-config';
import { ControlFlowStepType } from '../types/known-types';
import { ValidationIssueCode } from '../types/validation';
import type { ValidationIssue, ValidationResult } from '../types/validation';
import type { TriggerRegistry } from '../triggers/trigger-registry';
import type { StepRegistry } from '../steps/step-registry';
import { collectRefs, isPureRef } from '../util/variable-ref';
import { WEBHOOK_EVENT } from '../triggers/webhook.trigger';

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function declaredLeafToZod(type: string): z.ZodTypeAny {
  switch (type) {
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(z.unknown());
    case 'object':
      return z.record(z.unknown());
    case 'secret':
    case 'string':
    default:
      return z.string();
  }
}

function declaredToZod(declaredRaw: unknown): z.ZodTypeAny {
  if (!declaredRaw || typeof declaredRaw !== 'object' || Array.isArray(declaredRaw)) {
    return z.record(z.unknown());
  }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(declaredRaw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      shape[key] = declaredLeafToZod(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      shape[key] = declaredToZod(value);
    }
  }
  return z.object(shape).passthrough();
}

function buildWebhookTriggerOutputSchema(triggerConfig: unknown): z.ZodTypeAny {
  const cfg = (triggerConfig ?? {}) as { bodySchema?: unknown; headerSchema?: unknown };
  return z
    .object({
      body: declaredToZod(cfg.bodySchema),
      headers: declaredToZod(cfg.headerSchema),
      receivedAt: z.string(),
    })
    .passthrough();
}

function buildWebhookActionOutputSchema(stepConfig: unknown): z.ZodTypeAny {
  const cfg = (stepConfig ?? {}) as { responseSchema?: unknown };
  return z
    .object({
      status: z.number(),
      ok: z.boolean(),
      responseBody: z.string(),
      responseJson: declaredToZod(cfg.responseSchema).nullable(),
    })
    .passthrough();
}

function buildRunAgentOutputSchema(stepConfig: unknown): z.ZodTypeAny {
  const cfg = (stepConfig ?? {}) as { outputSchema?: unknown };
  return declaredToZod(cfg.outputSchema);
}

function walkSchemaPath(schema: z.ZodTypeAny, segments: string[]): z.ZodTypeAny | null {
  if (segments.some(s => FORBIDDEN_KEYS.has(s))) return null;

  let current: z.ZodTypeAny = schema;

  for (const segment of segments) {
    while (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
    }

    if (current instanceof z.ZodObject) {
      const next = (current.shape as Record<string, z.ZodTypeAny>)[segment];
      if (next) {
        current = next;
      } else {
        const def = current._def as { unknownKeys?: string; catchall?: z.ZodTypeAny };
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
      current = (current as z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>)._def.valueType;
    } else if (current instanceof z.ZodUnion) {
      const options = (current as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def.options;
      const walked = walkSchemaPath(options[0], [segment]);
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

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }

  return current;
}

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

function isZodCompatible(upstream: z.ZodTypeAny, consumer: z.ZodTypeAny): boolean {
  if (consumer instanceof z.ZodUnknown || consumer instanceof z.ZodAny) return true;
  if (upstream instanceof z.ZodUnknown || upstream instanceof z.ZodAny) return true;

  const upType = upstream._def.typeName as string;
  const conType = consumer._def.typeName as string;

  if (upType === conType) return true;

  if (SCALAR_LIKE_ZOD_TYPES.has(upType) && SCALAR_LIKE_ZOD_TYPES.has(conType)) return true;

  if (conType === 'ZodString') return true;

  return false;
}

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
  ZodDiscriminatedUnion: 'value',
  ZodTuple: 'list',
  ZodRecord: 'object',
};

function humanZodType(schema: z.ZodTypeAny): string {
  const name = schema._def.typeName as string;
  return ZOD_HUMAN_TYPE[name] ?? 'value';
}

export class ConfigValidator {
  constructor(
    private readonly triggerRegistry: TriggerRegistry,
    private readonly stepRegistry: StepRegistry,
  ) {}

  validate(config: AutomationConfig): ValidationResult {
    const issues: ValidationIssue[] = [];
    const outputSchemas = new Map<string, z.ZodSchema>();

    if (config.trigger) {
      if (!this.triggerRegistry.has(config.trigger.type)) {
        issues.push({
          path: 'trigger.type',
          code: ValidationIssueCode.SHAPE,
          message: `Unknown trigger type "${config.trigger.type}". Is it registered?`,
        });
      } else {
        const triggerImpl = this.triggerRegistry.get(config.trigger.type);
        const result = triggerImpl.configSchema.safeParse(config.trigger.config);
        if (!result.success) {
          for (const issue of result.error.issues) {
            issues.push({
              path: `trigger.config.${issue.path.join('.')}`,
              code: ValidationIssueCode.SHAPE,
              message: issue.message,
            });
          }
        }
        if (
          triggerImpl.requiresScopeFilter !== false &&
          triggerHasFilterFields(triggerImpl.configSchema)
        ) {
          const scopeFields = triggerImpl.scopeFilterFields;
          const scoped = scopeFields
            ? hasAnyFilterIn(config.trigger.config, scopeFields)
            : hasAnyFilter(config.trigger.config);
          if (!scoped) {
            issues.push({
              path: 'trigger.config',
              code: ValidationIssueCode.SHAPE,
              message: scopeFields
                ? `Scope this automation by at least one of: ${scopeFields.join(', ')} — so it does not fire on every event.`
                : 'Add at least one filter so the automation does not fire on every event.',
            });
          }
        }
        outputSchemas.set(
          'trigger',
          triggerImpl.type === WEBHOOK_EVENT
            ? buildWebhookTriggerOutputSchema(config.trigger.config)
            : triggerImpl.outputSchema,
        );
      }
    }

    this.walkSteps(config.steps, 'steps', outputSchemas, issues);

    return { valid: issues.length === 0, issues };
  }

  private walkSteps(
    steps: AutomationStepConfig[],
    prefix: string,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
  ): void {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as AutomationStepConfig;
      const stepPath = `${prefix}[${i}]`;

      if (step.type === ControlFlowStepType.CONDITIONAL) {
        this.validateConditionalStep(step as ConditionalStepConfig, stepPath, outputSchemas, issues);
        outputSchemas.set(`${step.id}.output`, z.object({ result: z.boolean() }));
        continue;
      }

      if (step.type === ControlFlowStepType.SWITCH) {
        this.validateSwitchStep(step as SwitchStepConfig, stepPath, outputSchemas, issues);
        outputSchemas.set(`${step.id}.output`, z.object({ matchedIndex: z.number() }));
        continue;
      }

      if (!this.stepRegistry.has(step.type)) {
        issues.push({
          path: `${stepPath}.type`,
          code: ValidationIssueCode.SHAPE,
          message: `Unknown step type "${step.type}". Is it registered?`,
        });
        continue;
      }

      const stepImpl = this.stepRegistry.get(step.type);

      const shapeResult = stepImpl.configSchema.safeParse(step.config);
      if (!shapeResult.success) {
        for (const issue of shapeResult.error.issues) {
          issues.push({
            path: `${stepPath}.config.${issue.path.join('.')}`,
            code: ValidationIssueCode.SHAPE,
            message: issue.message,
          });
        }
      }

      this.validateRefs(
        step.config,
        `${stepPath}.config`,
        stepImpl.configSchema,
        outputSchemas,
        issues,
      );

      if (step.type === 'SEND_MESSAGE') {
        const attachments = (step.config as { attachments?: unknown }).attachments;
        if (Array.isArray(attachments)) {
          attachments.forEach((attachment, attachmentIndex) => {
            const paths = (attachment as { templatePaths?: unknown })?.templatePaths;
            if (!Array.isArray(paths)) return;
            paths.forEach((path, pathIndex) => {
              if (typeof path !== 'string') return;
              this.checkRef(
                `{{context.${path}}}`,
                `${stepPath}.config.attachments[${attachmentIndex}].templatePaths[${pathIndex}]`,
                outputSchemas,
                issues,
                null,
              );
            });
          });
        }
      }

      outputSchemas.set(`${step.id}.input`, stepImpl.configSchema);
      outputSchemas.set(
        `${step.id}.output`,
        step.type === 'TRIGGER_WEBHOOK'
          ? buildWebhookActionOutputSchema(step.config)
          : step.type === 'RUN_AGENT'
            ? buildRunAgentOutputSchema(step.config)
            : stepImpl.outputSchema,
      );
    }
  }

  private validateConditionalStep(
    step: ConditionalStepConfig,
    stepPath: string,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
  ): void {
    const cfg = step.config;

    this.validateConditionRefs(cfg.condition, `${stepPath}.config.condition`, outputSchemas, issues);

    this.walkSteps(cfg.if_true, `${stepPath}.config.if_true`, new Map(outputSchemas), issues);
    if (cfg.if_false && cfg.if_false.length > 0) {
      this.walkSteps(cfg.if_false, `${stepPath}.config.if_false`, new Map(outputSchemas), issues);
    }
  }

  private validateSwitchStep(
    step: SwitchStepConfig,
    stepPath: string,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
  ): void {
    const cfg = step.config;

    for (let i = 0; i < cfg.cases.length; i++) {
      const caseEntry = cfg.cases[i]!;
      this.validateConditionRefs(
        caseEntry.condition,
        `${stepPath}.config.cases[${i}].condition`,
        outputSchemas,
        issues,
      );
      this.walkSteps(
        caseEntry.steps,
        `${stepPath}.config.cases[${i}].steps`,
        new Map(outputSchemas),
        issues,
      );
    }

    this.walkSteps(
      cfg.default,
      `${stepPath}.config.default`,
      new Map(outputSchemas),
      issues,
    );
  }

  private validateConditionRefs(
    condition: Condition,
    path: string,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
  ): void {
    if ('variable' in condition && 'operator' in condition) {
      this.checkRef(condition.variable, `${path}.variable`, outputSchemas, issues, null);
      // The value operand may itself be a variable reference (variable-to-variable
      // comparison). Validate its existence when it's a pure reference; literals
      // (numbers, booleans, plain strings) are left untouched.
      if (typeof condition.value === 'string' && isPureRef(condition.value)) {
        this.checkRef(condition.value, `${path}.value`, outputSchemas, issues, null);
      }
      return;
    }
    if ('all' in condition) {
      condition.all.forEach((child, i) =>
        this.validateConditionRefs(child, `${path}.all[${i}]`, outputSchemas, issues),
      );
      return;
    }
    if ('any' in condition) {
      condition.any.forEach((child, i) =>
        this.validateConditionRefs(child, `${path}.any[${i}]`, outputSchemas, issues),
      );
    }
  }

  private validateRefs(
    config: Record<string, unknown>,
    prefix: string,
    configSchema: z.ZodSchema,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
  ): void {
    for (const { refPath, location } of collectRefs(config, prefix)) {
      const consumerInner = this.getConsumerInnerSchema(configSchema, location, prefix);
      this.checkRef(`{{context.${refPath}}}`, location, outputSchemas, issues, consumerInner);
    }
  }

  private checkRef(
    refString: string,
    location: string,
    outputSchemas: Map<string, z.ZodSchema>,
    issues: ValidationIssue[],
    consumerInnerSchema: z.ZodTypeAny | null,
  ): void {
    const inner = refString.match(/^\{\{(?:context\.)?([^}]+)\}\}$/);
    if (!inner || !inner[1]) return;

    const refPath = inner[1];
    const segments = refPath.split('.');
    const sourceKey = segments[0];
    if (!sourceKey) return;

    let resolverKey: string;
    let pathSegments: string[];
    if (sourceKey === 'trigger') {
      resolverKey = 'trigger';
      pathSegments = segments.slice(1);
    } else if (sourceKey === 'automation') {
      return;
    } else {
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
        message: `"${refString}" references "${sourceKey}" which is not yet available at this point in the automation (forward reference, or unknown step / trigger ID).`,
      });
      return;
    }

    const sourceSchema = outputSchemas.get(resolverKey)!;
    const leafSchema = walkSchemaPath(sourceSchema, pathSegments);

    if (leafSchema === null) {
      issues.push({
        path: location,
        code: ValidationIssueCode.UNKNOWN_REFERENCE,
        message: `"${refString}" — path "${pathSegments.join('.')}" does not exist in the schema of "${resolverKey}".`,
      });
      return;
    }

    if (consumerInnerSchema !== null) {
      if (!isZodCompatible(leafSchema, consumerInnerSchema)) {
        issues.push({
          path: location,
          code: ValidationIssueCode.TYPE_MISMATCH,
          message: `"${refString}" is a ${humanZodType(leafSchema)} but this field expects a ${humanZodType(consumerInnerSchema)}.`,
        });
      }
    }
  }

  private getConsumerInnerSchema(
    configSchema: z.ZodSchema,
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

    const leafSchema = walkSchemaPath(configSchema as z.ZodTypeAny, segments);
    if (!leafSchema) return null;
    return getVariableRefInnerSchema(leafSchema);
  }
}

function triggerHasFilterFields(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodObject) {
    return Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape).length > 0;
  }
  return true;
}

function isMeaningfulFilterValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

/** True if at least one of the named scope fields holds a meaningful value. */
function hasAnyFilterIn(config: unknown, fields: readonly string[]): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const record = config as Record<string, unknown>;
  return fields.some(field => isMeaningfulFilterValue(record[field]));
}

function hasAnyFilter(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  for (const value of Object.values(config as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 0) return true;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) return true;
      continue;
    }
    if (typeof value === 'number') return true;
    if (typeof value === 'object') {
      if (Object.keys(value).length > 0) return true;
      continue;
    }
  }
  return false;
}
