import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry, ConnectorRegistrationError } from './connector-registry.js';
import { BaseConnector } from './base-connector.js';
import type { AnyStep, AnyTrigger } from './base-connector.js';
import { BaseActionStep } from '../../steps/base-step.js';
import { EventTrigger } from '../../triggers/event-trigger.js';
import { TriggerCategory } from '../../types/categories.js';
import { withOptions } from '../../util/schema-marks.js';
import type { FieldOptionsPage } from '../../schema/options.js';

/**
 * A picker with no loader is a wiring mistake, and the only place it is visible
 * is here. In the editor it looks exactly like "you have no repositories".
 */

const Picked = z.object({ repo: withOptions(z.string()) });
const Plain = z.object({ repo: z.string() });

class Step extends BaseActionStep<typeof Picked | typeof Plain> {
  override readonly type = 'ACME_PICK';
  override readonly name = 'Pick';
  override readonly description = 'test step';
  override readonly outputSchema = z.object({});
  override readonly category = 'test';
  override readonly configSchema: typeof Picked | typeof Plain;

  constructor(schema: typeof Picked | typeof Plain, loader = false) {
    super();
    this.configSchema = schema;
    if (loader) {
      this.getOptions = async (): Promise<FieldOptionsPage> => ({ items: [] });
    }
  }

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }
}

class Trigger extends EventTrigger<typeof Picked> {
  override readonly type = 'ACME_PICK_EVENT';
  override readonly configSchema = Picked;
  override readonly name = 'Pick event';
  override readonly description = 'test trigger';
  override readonly outputSchema = z.object({});
  override readonly category = TriggerCategory.EVENT;
}

function connector(over: { steps?: readonly AnyStep[]; triggers?: readonly AnyTrigger[] }): BaseConnector {
  return new (class extends BaseConnector {
    override readonly id = 'acme';
    override readonly version = '1.0.0';
    override readonly name = 'Acme';
    override readonly description = 'test connector';
    override readonly credentials = [];
    override readonly steps = over.steps ?? [];
    override readonly triggers = over.triggers ?? [];
  })();
}

describe('a marked field needs a loader', () => {
  it('refuses a step that offers choices it cannot answer', () => {
    expect(() => new ConnectorRegistry().register(connector({ steps: [new Step(Picked)] }))).toThrow(
      ConnectorRegistrationError,
    );
    expect(() => new ConnectorRegistry().register(connector({ steps: [new Step(Picked)] }))).toThrow(
      /withOptions\(\) but does not implement getOptions\(\)/,
    );
  });

  it('refuses a trigger on the same grounds', () => {
    expect(() => new ConnectorRegistry().register(connector({ triggers: [new Trigger()] }))).toThrow(
      /trigger "ACME_PICK_EVENT" wraps a config field/,
    );
  });

  it('accepts a step that answers for its marked field', () => {
    expect(() =>
      new ConnectorRegistry().register(connector({ steps: [new Step(Picked, true)] })),
    ).not.toThrow();
  });

  it('says nothing about a component with no marked fields', () => {
    expect(() => new ConnectorRegistry().register(connector({ steps: [new Step(Plain)] }))).not.toThrow();
  });
});
