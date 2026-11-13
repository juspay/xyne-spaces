/**
 * What the conversation is started with.
 *
 * The bar is that declaring it makes the promise real in all three places it
 * matters: the reader offers the names, the validator checks a reference against
 * them, and an undeclared one is refused.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { readConversationalFlow } from '../read.js';
import { setPromptSays } from './prompts.js';
import { setConversationInputs } from './inputs.js';

const read = (config: WorkflowConfig) => readConversationalFlow(config)!;
const issues = (config: WorkflowConfig) => new ConfigValidator(new ConnectorRegistry()).validate(config).issues;
const made = () => createConversationalFlow({ title: 'Support' }).config;

describe('what the conversation is started with', () => {
  it('promises nothing until it is declared', () => {
    expect(read(made()).inputs).toEqual([]);
  });

  it('declares names, nested ones included', () => {
    const next = setConversationInputs(made(), [{ path: 'orderId' }, { path: 'customer.tier' }]);
    expect(read(next).inputs.map((i) => i.path)).toEqual(['orderId', 'customer.tier']);
    expect(issues(next)).toEqual([]);
  });

  it('is what a screen may quote — and the validator holds it to that', () => {
    const declared = setConversationInputs(made(), [{ path: 'orderId' }]);
    const flow = read(declared);
    const question = flow.screens.find((s) => s.id === 'start')!.prompts[0]!.id;

    const good = setPromptSays(declared, question, ['Order {{trigger.context.orderId}} — what do you need?']);
    expect(issues(good)).toEqual([]);

    const bad = setPromptSays(declared, question, ['Hello {{trigger.context.nickname}}']);
    expect(issues(bad).map((i) => i.code)).toContain('unknownReference');
  });

  it('forgets them when the list is emptied', () => {
    const declared = setConversationInputs(made(), [{ path: 'orderId' }]);
    const forgotten = setConversationInputs(declared, []);
    expect(read(forgotten).inputs).toEqual([]);
    expect(JSON.stringify(forgotten)).not.toContain('inputSchema');
  });

  it('refuses a name that could never be quoted', () => {
    expect(() => setConversationInputs(made(), [{ path: 'order id' }])).toThrow(/letters, numbers/);
  });
});
