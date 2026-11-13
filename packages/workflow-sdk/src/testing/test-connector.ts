/**
 * A throwaway connector for tests.
 *
 * `ConnectorRegistry` has no `registerStep` on purpose — a component may only
 * enter the system as part of a connector, because every check the registry
 * makes depends on knowing the owner. That is right in production and
 * inconvenient in a test that wants one fake step, so this wraps loose
 * components in a connector named `test`.
 */
import { BaseConnector } from '../connectors/core/base-connector.js';
import type { AnyStep, AnyTrigger } from '../connectors/core/base-connector.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { CredentialDefinition } from '../connectors/core/credentials.js';

export class TestConnector extends BaseConnector {
  override readonly id = 'test';
  override readonly version = '1.0.0';
  override readonly name = 'Test';
  override readonly description = 'Components under test';
  /** Whatever the components under test accept; empty unless a case sets it. */
  override readonly credentials: readonly CredentialDefinition[];
  override readonly steps: readonly AnyStep[];
  override readonly triggers: readonly AnyTrigger[];

  constructor(components?: {
    steps?: readonly AnyStep[];
    triggers?: readonly AnyTrigger[];
    credentials?: readonly CredentialDefinition[];
  }) {
    super();
    this.steps = components?.steps ?? [];
    this.triggers = components?.triggers ?? [];
    this.credentials = components?.credentials ?? [];
  }
}

/**
 * A registry holding these components, under one test connector.
 *
 * The built-ins (CODE, WAIT, DELAY, LOOP, …) come with every `ConnectorRegistry`, so
 * cases that drive a real control-flow step need nothing extra here.
 */
export function testRegistry(components?: {
  steps?: readonly AnyStep[];
  triggers?: readonly AnyTrigger[];
  credentials?: readonly CredentialDefinition[];
}): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register(new TestConnector(components));
  return registry;
}

