import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { z } from 'zod';
import { VariableResolver, resolvePath } from './variable-resolver.js';
import { ConfigValidator } from './config-validator.js';
import { BaseActionStep, cloneScope } from '../steps/base-step.js';
import type { StepExecutionContext } from '../steps/base-step.js';
import { BaseTrigger } from '../triggers/base-trigger.js';
import { TriggerCategory } from '../types/categories.js';
import { ValidationIssueCode } from '../types/validation.js';
import { createMockContext } from '../testing/mock-context.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { WorkflowVariable } from '../types/workflow-variable.js';
import type { Attachment } from '../common/attachment.js';

const policy: Attachment = { name: 'policy.pdf', mimeType: 'application/pdf', handle: 'mem://policy' };

function ctxWithVars() {
  return createMockContext({
    vars: {
      companyName: 'Acme',
      threshold: 42,
      rules: { max: 3, names: ['first', 'second'] },
      policyDoc: policy,
    },
  });
}

describe('{{vars.*}} resolution', () => {
  const resolver = new VariableResolver();
  const ctx = ctxWithVars();

  it('resolves a scalar as a pure ref with its type preserved', () => {
    expect(resolver.resolve('{{vars.companyName}}', ctx)).toBe('Acme');
    expect(resolver.resolve('{{vars.threshold}}', ctx)).toBe(42); // number, not "42"
  });

  it('walks nested JSON with dot-numeric indexing', () => {
    expect(resolvePath(ctx, 'vars.rules.max')).toBe(3);
    expect(resolvePath(ctx, 'vars.rules.names.1')).toBe('second');
  });

  it('passes an Attachment value through untouched (mountable document)', () => {
    expect(resolver.resolve('{{vars.policyDoc}}', ctx)).toEqual(policy);
  });

  it('interpolates inside a template string', () => {
    expect(resolver.resolve('Hello {{vars.companyName}}!', ctx)).toBe('Hello Acme!');
  });

  it('returns undefined for an unknown key without throwing', () => {
    expect(resolvePath(ctx, 'vars.missing')).toBeUndefined();
  });
});

describe('cloneScope propagates vars into branch/loop scopes', () => {
  it('carries the same vars reference into a child scope', () => {
    const ctx = ctxWithVars();
    const child = cloneScope(ctx);
    expect(child.vars).toBe(ctx.vars);
    expect(resolvePath(child, 'vars.companyName')).toBe('Acme');
  });
});

// ─── Validator: {{vars.<key>}} must reference a declared variable ───

const TriggerConfig = z.object({});
class TestTrigger extends BaseTrigger<typeof TriggerConfig> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = TriggerConfig;
  readonly name = 'Test';
  readonly description = 'test';
  readonly outputSchema = z.object({});
  readonly category = TriggerCategory.EVENT;
}

const EchoConfig = z.object({ body: z.string() });
class EchoStep extends BaseActionStep<typeof EchoConfig, { ok: boolean }> {
  readonly type = 'ECHO';
  readonly configSchema = EchoConfig;
  readonly name = 'Echo';
  readonly description = 'echo';
  readonly outputSchema = z.object({ ok: z.boolean() });
  readonly category = 'test';
  async execute(_c: z.infer<typeof EchoConfig>, _ctx: StepExecutionContext): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

function makeValidator(): ConfigValidator {
  const connectors = testRegistry({ triggers: [new TestTrigger()], steps: [new EchoStep()] });
  return new ConfigValidator(connectors);
}

function configWith(body: string, variables: WorkflowVariable[] | undefined): WorkflowConfig {
  return {
    trigger: { type: 'TEST_EVENT', config: {} },
    variables,
    steps: [{ id: 's1', type: 'ECHO', config: { body } }],
  } as WorkflowConfig;
}

describe('validator — {{vars.*}}', () => {
  it('accepts a reference to a declared variable', () => {
    const res = makeValidator().validate(
      configWith('Hello {{vars.companyName}}', [{ key: 'companyName', type: 'text', value: 'Acme' }]),
    );
    expect(res.issues.filter((i) => i.message.includes('vars.'))).toEqual([]);
  });

  it('flags a reference to an undeclared variable', () => {
    const res = makeValidator().validate(
      configWith('{{vars.missing}}', [{ key: 'companyName', type: 'text', value: 'Acme' }]),
    );
    const varIssues = res.issues.filter(
      (i) => i.code === ValidationIssueCode.UNKNOWN_REFERENCE && i.message.includes('vars.missing'),
    );
    expect(varIssues).toHaveLength(1);
  });

  it('flags any {{vars.x}} when no variables are declared', () => {
    const res = makeValidator().validate(configWith('{{vars.anything}}', undefined));
    expect(res.issues.some((i) => i.message.includes('vars.anything'))).toBe(true);
  });
});
