import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from './connector-registry.js';

describe('ConnectorRegistry summaries', () => {
  it("carry the owning connector's id, name and icon, for the builder's connector list", () => {
    const registry = new ConnectorRegistry();

    const triggers = registry.listTriggerSummaries();
    const steps = registry.listStepSummaries();

    expect(triggers.length).toBeGreaterThan(0);
    expect(steps.length).toBeGreaterThan(0);
    for (const summary of [...triggers, ...steps]) {
      expect(summary).toMatchObject({
        connectorId: 'builtin',
        connectorName: 'Built-in',
        connectorIcon: 'blocks',
      });
    }
  });
});
