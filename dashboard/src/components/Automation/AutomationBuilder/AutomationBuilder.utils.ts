import type {
  AutomationConfig,
  AutomationStepConfig,
  ActionStepConfig,
  ConditionalStepConfig,
  StepSchema,
  TriggerSchema,
  ValidationIssue,
} from '../Automation.types';
import { CONDITIONAL_STEP_TYPE } from '../Automation.types';
import type { VariablePickerSource } from './VariablePicker/VariablePicker.types';

export function emptyConfig(): AutomationConfig {
  return {
    trigger: { type: '', config: {} },
    steps: [],
  };
}

export function buildVariableSources(
  triggerSchema: TriggerSchema | null,
  triggerConfig: Record<string, unknown>,
  steps: AutomationStepConfig[],
  schemaCache: Record<string, StepSchema | undefined>,
  upToIndex: number,
): VariablePickerSource[] {
  const sources: VariablePickerSource[] = [];
  if (triggerSchema) {
    sources.push({
      sourceKey: 'trigger',
      role: 'trigger',
      label: 'Trigger',
      sublabel: triggerSchema.name,
      groupKey: 'trigger',
      groupLabel: `Trigger — ${triggerSchema.name}`,
      schema:
        triggerSchema.type === 'WEBHOOK'
          ? buildWebhookTriggerOutputSchema(triggerConfig)
          : triggerSchema.outputSchema,
    });
  }

  for (let i = 0; i < upToIndex; i++) {
    const step = steps[i];
    if (!step) continue;
    if (step.type === CONDITIONAL_STEP_TYPE) continue;
    const schema = schemaCache[step.type];
    if (!schema) continue;
    const groupLabel = `Step ${i + 1} — ${schema.name}`;
    sources.push({
      sourceKey: step.id,
      role: 'input',
      label: `Step ${i + 1} input`,
      sublabel: schema.name,
      groupKey: step.id,
      groupLabel,
      schema: schema.configSchema,
    });

    const outputSchema =
      step.type === 'RUN_AGENT'
        ? buildOutputSchemaFromRunAgentConfig(step.config)
        : schema.outputSchema;
    sources.push({
      sourceKey: step.id,
      role: 'output',
      label: `Step ${i + 1} output`,
      sublabel: schema.name,
      groupKey: step.id,
      groupLabel,
      schema: outputSchema,
    });
  }

  return sources;
}

function buildOutputSchemaFromRunAgentConfig(
  config: Record<string, unknown>,
): import('../Automation.types').JsonSchema {
  const declaredRaw = (config as { outputSchema?: unknown }).outputSchema;
  const declared: Record<string, string> =
    declaredRaw && typeof declaredRaw === 'object' ? (declaredRaw as Record<string, string>) : {};
  const properties: Record<string, import('../Automation.types').JsonSchema> = {};
  for (const [key, type] of Object.entries(declared)) {
    properties[key] = {
      type: type as 'string' | 'number' | 'boolean' | 'object' | 'array',
    };
  }
  return {
    type: 'object',
    properties,
    additionalProperties: true,
  };
}

type JsonSchemaT = import('../Automation.types').JsonSchema;

function jsonSchemaFromDeclared(declaredRaw: unknown): JsonSchemaT {
  const declared =
    declaredRaw && typeof declaredRaw === 'object' && !Array.isArray(declaredRaw)
      ? (declaredRaw as Record<string, unknown>)
      : {};
  const properties: Record<string, JsonSchemaT> = {};
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === 'string') {
      const t = value === 'secret' ? 'string' : value;
      properties[key] = { type: t as 'string' | 'number' | 'boolean' | 'object' | 'array' };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      properties[key] = jsonSchemaFromDeclared(value);
    }
  }
  return { type: 'object', properties, additionalProperties: true };
}

/** Build the webhook trigger's output schema from its body/header schemas. */
function buildWebhookTriggerOutputSchema(triggerConfig: Record<string, unknown>): JsonSchemaT {
  const cfg = triggerConfig as { bodySchema?: unknown; headerSchema?: unknown };
  return {
    type: 'object',
    properties: {
      body: jsonSchemaFromDeclared(cfg.bodySchema),
      headers: jsonSchemaFromDeclared(cfg.headerSchema),
      receivedAt: { type: 'string' },
    },
    additionalProperties: true,
  };
}

export function moveStep(
  steps: AutomationStepConfig[],
  index: number,
  direction: -1 | 1,
): AutomationStepConfig[] {
  const next = index + direction;
  if (next < 0 || next >= steps.length) return steps;
  const copy = steps.slice();
  const a = copy[index];
  const b = copy[next];
  if (!a || !b) return steps;
  copy[index] = b;
  copy[next] = a;
  return copy;
}

export function collectStepTypes(steps: AutomationStepConfig[]): string[] {
  const set = new Set<string>();
  walk(steps, set);
  return Array.from(set);
}

function walk(steps: AutomationStepConfig[], set: Set<string>): void {
  for (const step of steps) {
    if (step.type === CONDITIONAL_STEP_TYPE) {
      const cond = step as ConditionalStepConfig;
      walk(cond.config.if_true ?? [], set);
      walk(cond.config.if_false ?? [], set);
      continue;
    }
    set.add((step as ActionStepConfig).type);
  }
}

export function issuesUnder(all: ValidationIssue[] | undefined, prefix: string): ValidationIssue[] {
  if (!all) return [];
  return all.filter(i => i.path.startsWith(prefix));
}
