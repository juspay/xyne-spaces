import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CredentialAuthType } from '../../common/credentials.js';
import {
  defineCredential,
  acceptsCredential,
  declareSteps,
  NO_CREDENTIAL,
} from './credentials.js';
import { ConnectorRegistry, ConnectorRegistrationError } from './connector-registry.js';
import { BaseConnector } from './base-connector.js';
import type { AnyStep, AnyTrigger } from './base-connector.js';
import type { CredentialDefinition } from './credentials.js';
import { BaseActionStep } from '../../steps/base-step.js';
import type { StepExecutionContext } from '../../steps/base-step.js';
import { EventTrigger } from '../../triggers/event-trigger.js';
import { TriggerCategory } from '../../types/categories.js';

// ─── Fixtures ───

const ACME_TOKEN = defineCredential({
  connectorId: 'acme',
  credType: 'ACME_TOKEN',
  label: 'Acme Token',
  authType: CredentialAuthType.Bearer,
});

/** Same shape as ACME_TOKEN, different owner and type. */
const OTHER_TOKEN = defineCredential({
  connectorId: 'other',
  credType: 'OTHER_TOKEN',
  label: 'Other Token',
  authType: CredentialAuthType.Bearer,
});

class NoopStep<
  TCredential extends CredentialDefinition = CredentialDefinition,
> extends BaseActionStep<z.ZodObject<Record<string, never>>> {
  override readonly type = 'ACME_NOOP';
  override readonly configSchema = z.object({});
  override readonly name = 'Noop';
  override readonly description = 'test step';
  override readonly outputSchema = z.object({});
  override readonly category = 'test';
  // Generic so the OWNER survives in the type — a step annotated with the wide
  // `CredentialDefinition[]` has no literal left for `declareSteps` to check.
  override readonly credential: readonly TCredential[];

  constructor(credential: readonly TCredential[]) {
    super();
    this.credential = credential;
  }

  async execute(
    _config: Record<string, never>,
    _ctx: StepExecutionContext,
  ): Promise<Record<string, unknown>> {
    return {};
  }
}

class AcmeEventTrigger extends EventTrigger<z.ZodObject<Record<string, never>>> {
  override readonly type = 'ACME_EVENT';
  override readonly configSchema = z.object({});
  override readonly name = 'Acme event';
  override readonly description = 'test trigger';
  override readonly outputSchema = z.object({});
  override readonly category = TriggerCategory.EVENT;
  override readonly credential: readonly CredentialDefinition[];
  override readonly credentialSlots: readonly { name: string; required: boolean }[];

  constructor(
    credential: readonly CredentialDefinition[],
    slots: readonly { name: string; required: boolean }[] = [],
  ) {
    super();
    this.credential = credential;
    this.credentialSlots = slots;
  }
}

function connector(over: {
  id?: string;
  credentials?: readonly CredentialDefinition[];
  steps?: readonly AnyStep[];
  triggers?: readonly AnyTrigger[];
}): BaseConnector {
  return new (class extends BaseConnector {
    override readonly id = over.id ?? 'acme';
    override readonly version = '1.0.0';
    override readonly name = 'Acme';
    override readonly description = 'test connector';
    override readonly credentials = over.credentials ?? [];
    override readonly steps = over.steps ?? [];
    override readonly triggers = over.triggers ?? [];
  })();
}

// ─── Tests ───

describe('defineCredential', () => {
  it('keeps the connector’s own type and owner', () => {
    expect(ACME_TOKEN.credType).toBe('ACME_TOKEN');
    expect(ACME_TOKEN.connectorId).toBe('acme');
    expect(ACME_TOKEN.authType).toBe('bearer');
  });

  it('freezes the definition — a component holds the same object, not a copy', () => {
    expect(Object.isFrozen(ACME_TOKEN)).toBe(true);
  });
});

describe('acceptsCredential', () => {
  it('matches on the type, so two providers sharing a shape stay apart', () => {
    expect(acceptsCredential([ACME_TOKEN], 'ACME_TOKEN')).toBe(true);
    expect(acceptsCredential([ACME_TOKEN], 'OTHER_TOKEN')).toBe(false);
  });

  it('accepts nothing when the requirement is empty', () => {
    expect(acceptsCredential(NO_CREDENTIAL, 'ACME_TOKEN')).toBe(false);
  });
});

describe('ConnectorRegistry — credential declarations', () => {
  it('registers a connector whose step accepts a type it declares', () => {
    const registry = new ConnectorRegistry();
    expect(() =>
      registry.register(
        connector({
          credentials: [ACME_TOKEN],
          steps: [new NoopStep([ACME_TOKEN]) as AnyStep],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a step accepting a credential its connector never declared', () => {
    // The failure this prevents: the picker renders empty and the run fails
    // with "no credential configured", which points at the user rather than
    // at the wiring.
    const registry = new ConnectorRegistry();
    expect(() =>
      registry.register(
        connector({ credentials: [], steps: [new NoopStep([ACME_TOKEN]) as AnyStep] }),
      ),
    ).toThrow(/accepts credential type "ACME_TOKEN", which connector "acme" does not declare/);
  });

  it('rejects a trigger accepting a credential its connector never declared', () => {
    const registry = new ConnectorRegistry();
    expect(() =>
      registry.register(
        connector({ credentials: [], triggers: [new AcmeEventTrigger([ACME_TOKEN]) as AnyTrigger] }),
      ),
    ).toThrow(/trigger "ACME_EVENT" accepts credential type "ACME_TOKEN"/);
  });

  it('rejects a trigger declaring the same credential slot twice', () => {
    const registry = new ConnectorRegistry();
    expect(() =>
      registry.register(
        connector({
          credentials: [ACME_TOKEN],
          triggers: [
            new AcmeEventTrigger(
              [ACME_TOKEN],
              [
                { name: 'token', required: true },
                { name: 'token', required: false },
              ],
            ) as AnyTrigger,
          ],
        }),
      ),
    ).toThrow(/declares credential slot "token" twice/);
  });

  it('rejects a connector declaring another connector’s credential', () => {
    const registry = new ConnectorRegistry();
    expect(() => registry.register(connector({ credentials: [OTHER_TOKEN] }))).toThrow(
      /belongs to connector "other" but is declared by "acme"/,
    );
  });

  it('rejects a type that is not SCREAMING_SNAKE_CASE', () => {
    const registry = new ConnectorRegistry();
    const lower = defineCredential({
      connectorId: 'acme',
      credType: 'acme.token',
      label: 'Lower',
      authType: CredentialAuthType.Bearer,
    });
    expect(() => registry.register(connector({ credentials: [lower] }))).toThrow(
      /must be SCREAMING_SNAKE_CASE/,
    );
  });

  it('rejects a type another connector already declared', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector({ id: 'acme', credentials: [ACME_TOKEN] }));
    const clash = defineCredential({
      connectorId: 'rival',
      credType: 'ACME_TOKEN',
      label: 'Clash',
      authType: CredentialAuthType.Bearer,
    });
    expect(() => registry.register(connector({ id: 'rival', credentials: [clash] }))).toThrow(
      /already declared by connector "acme"/,
    );
  });

  it('rejects the same credential declared twice', () => {
    const registry = new ConnectorRegistry();
    expect(() =>
      registry.register(connector({ credentials: [ACME_TOKEN, ACME_TOKEN] })),
    ).toThrow(ConnectorRegistrationError);
  });

  it('reports every problem at once, so one restart shows them all', () => {
    const registry = new ConnectorRegistry();
    try {
      registry.register(
        connector({
          credentials: [OTHER_TOKEN, OTHER_TOKEN],
          steps: [new NoopStep([ACME_TOKEN]) as AnyStep],
        }),
      );
      throw new Error('expected registration to fail');
    } catch (err) {
      const problems = (err as ConnectorRegistrationError).problems;
      expect(problems.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('ConnectorRegistry — credential lookups', () => {
  it('finds a definition by type, and throws for an unknown one on get', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector({ credentials: [ACME_TOKEN] }));
    expect(registry.getCredentialDefinition('ACME_TOKEN')).toBe(ACME_TOKEN);
    expect(registry.findCredentialDefinition('NOPE')).toBeUndefined();
    expect(() => registry.getCredentialDefinition('NOPE')).toThrow(/unknown credential "NOPE"/);
  });

  it('lists types grouped by connector, with the form fields of each shape', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector({ credentials: [ACME_TOKEN] }));
    const groups = registry.listCredentialTypes();

    const builtin = groups.find((g) => g.connectorId === 'builtin');
    expect(builtin?.credentials.map((c) => c.credType)).toEqual([
      'BUILTIN_BEARER',
      'BUILTIN_BASIC',
      'BUILTIN_CUSTOM_HEADER',
      'BUILTIN_OAUTH2_CLIENT_CREDENTIALS',
      'BUILTIN_ENDPOINT_KEY',
    ]);

    const acme = groups.find((g) => g.connectorId === 'acme');
    expect(acme).toEqual({
      connectorId: 'acme',
      connectorName: 'Acme',
      credentials: [
        {
          credType: 'ACME_TOKEN',
          label: 'Acme Token',
          authType: 'bearer',
          fields: [{ key: 'token', label: 'Token', control: 'password' }],
        },
      ],
    });
  });

  it('omits connectors that declare no credentials', () => {
    const registry = new ConnectorRegistry();
    registry.register(connector({ credentials: [] }));
    expect(registry.listCredentialTypes().map((g) => g.connectorId)).toEqual(['builtin']);
  });
});

// ─── Compile-time check ───
//
// `declareSteps` is meant to catch a step reaching for another connector's
// credential IN THE EDITOR. That guarantee is a type relationship, so it is
// asserted with `@ts-expect-error`: if the mismatch ever stops being an error,
// the directive itself becomes the error and the build fails. Nothing here runs
// a meaningful assertion — the typecheck is the test.

describe('declareSteps — compile-time ownership', () => {
  it('accepts a step whose credentials the connector declares', () => {
    const steps = declareSteps([ACME_TOKEN], [new NoopStep([ACME_TOKEN])]);
    expect(steps).toHaveLength(1);
  });

  it('rejects a step reaching for another connector’s credential', () => {
    const steps = declareSteps(
      [ACME_TOKEN],
      // @ts-expect-error OTHER_TOKEN belongs to connector "other", not "acme"
      [new NoopStep([OTHER_TOKEN])],
    );
    // The registry rejects it too, at boot — see the case above. This asserts
    // the earlier, cheaper failure.
    expect(steps).toHaveLength(1);
  });
});
