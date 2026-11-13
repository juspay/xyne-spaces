/**
 * ConnectorRegistry — the single place components become known to the system.
 *
 * ─── What it replaces ───
 *
 * A host used to assemble four separate things by hand: `StepRegistry`,
 * `TriggerRegistry`, `ServiceRegistry`, and a fixed central credential union.
 * Nothing tied them together, so a step could register while the service it
 * needed did not, and a credential could exist that no component could name —
 * failing mid-execution. Those three registries are gone; this is the one.
 *
 * A host registers ONE complete connector and gets all of it at once:
 *
 *     connectors.register(new GmailConnector());
 *
 * There is deliberately no `registerStep`, `registerTrigger`, or
 * `registerCredential`. If those existed, a component could enter the system
 * without an owning connector — and every check below depends on knowing the
 * owner.
 */

import type { BaseConnector, AnyStep, AnyTrigger } from './base-connector.js';
import { schemaOffersOptions } from '../../util/schema-marks.js';
import { zodToJsonSchemaRecord } from '../../util/schema-convert.js';
import { BuiltinConnector } from '../builtin/builtin-connector.js';
import type { StepSummary, StepDescriptor } from '../../steps/step-descriptor.js';
import { buildStepSummary, buildStepDescriptor } from '../../steps/step-descriptor.js';
import type { TriggerSummary, TriggerDescriptor } from '../../triggers/trigger-descriptor.js';
import { buildTriggerSummary, buildTriggerDescriptor } from '../../triggers/trigger-descriptor.js';
import type { CredentialDefinition } from './credentials.js';
import { CREDENTIAL_TYPE_PATTERN } from './credentials.js';
import { CREDENTIAL_AUTH_REGISTRY } from '../../common/credentials.js';
import type { ConnectorCredentialTypes } from '../../common/credentials.js';

// ─── Registered views ───

/** A step plus the identity of the connector that provides it. */
export interface RegisteredStep {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly step: AnyStep;
}

/** A trigger plus the identity of the connector that provides it. */
export interface RegisteredTrigger {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly trigger: AnyTrigger;
}

/** A credential definition plus the identity of the connector that declares it. */
export interface RegisteredCredential {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly definition: CredentialDefinition;
}



// ─── Errors ───

/**
 * A connector was rejected at registration.
 *
 * Carries EVERY problem found, not just the first. Registration happens at
 * boot, so a developer fixing a new connector otherwise plays whack-a-mole:
 * restart, see one error, fix, restart. One throw listing all four mistakes
 * turns that into a single edit.
 */
export class ConnectorRegistrationError extends Error {
  readonly connectorId: string;
  readonly problems: readonly string[];

  constructor(connectorId: string, problems: readonly string[]) {
    super(
      `ConnectorRegistry: cannot register connector "${connectorId}":\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'ConnectorRegistrationError';
    this.connectorId = connectorId;
    this.problems = problems;
  }
}

/** A lookup named something that was never registered. */
export class UnknownComponentError extends Error {
  readonly kind: 'connector' | 'step' | 'trigger' | 'credential';
  readonly id: string;

  constructor(kind: 'connector' | 'step' | 'trigger' | 'credential', id: string) {
    super(
      `ConnectorRegistry: unknown ${kind} "${id}". ` +
        `Is its connector registered at boot?`,
    );
    this.name = 'UnknownComponentError';
    this.kind = kind;
    this.id = id;
  }
}

// ─── Registry ───

export class ConnectorRegistry {
  private readonly connectorsById = new Map<string, BaseConnector>();
  private readonly stepsByType = new Map<string, RegisteredStep>();
  private readonly triggersByType = new Map<string, RegisteredTrigger>();
  private readonly credentialsByType = new Map<string, RegisteredCredential>();

  constructor() {
    this.register(new BuiltinConnector());
  }

  /**
   * Register a complete connector, or reject it entirely.
   *
   * @throws {ConnectorRegistrationError} listing every problem found.
   */
  register(connector: BaseConnector): void {
    const problems = this.findProblems(connector);
    if (problems.length > 0) {
      throw new ConnectorRegistrationError(connector.id, problems);
    }

    // Commit. Only reached when the connector is wholly valid, so no partial
    // write is possible — this is the atomicity guarantee, and it is why
    // validation cannot be interleaved with insertion.
    this.connectorsById.set(connector.id, connector);

    for (const definition of connector.credentials) {
      this.credentialsByType.set(definition.credType, {
        connectorId: connector.id,
        connectorName: connector.name,
        definition,
      });
    }

    for (const step of connector.steps) {
      // Stamp WHO owns it, so the palette can group by connector. The step
      // itself never sets these — its owner does, here, at registration.
      stampOwner(step, connector);
      this.stepsByType.set(step.type, {
        connectorId: connector.id,
        connectorName: connector.name,
        step,
      });
    }

    for (const trigger of connector.triggers) {
      stampOwner(trigger, connector);
      this.triggersByType.set(trigger.type, {
        connectorId: connector.id,
        connectorName: connector.name,
        trigger,
      });
    }
  }

  // ─── Lookups ───

  /** @throws {UnknownComponentError} when no such connector is registered. */
  getConnector(connectorId: string): BaseConnector {
    const connector = this.connectorsById.get(connectorId);
    if (!connector) throw new UnknownComponentError('connector', connectorId);
    return connector;
  }

  /** @throws {UnknownComponentError} when no registered connector provides it. */
  getStep(stepType: string): AnyStep {
    const registered = this.stepsByType.get(stepType);
    if (!registered) throw new UnknownComponentError('step', stepType);
    return registered.step;
  }

  /** @throws {UnknownComponentError} when no registered connector provides it. */
  getTrigger(triggerType: string): AnyTrigger {
    const registered = this.triggersByType.get(triggerType);
    if (!registered) throw new UnknownComponentError('trigger', triggerType);
    return registered.trigger;
  }

  /**
   * Non-throwing lookups, for callers deciding IF a component exists rather
   * than assuming it does — validating a saved workflow against the connectors
   * this deployment actually registered, for instance.
   *
   * Without these, "is this step available?" has to be written as try/catch
   * around `getStep()`, which is control flow by exception and swallows real
   * errors as readily as missing ones.
   */
  findStep(stepType: string): RegisteredStep | undefined {
    return this.stepsByType.get(stepType);
  }

  findTrigger(triggerType: string): RegisteredTrigger | undefined {
    return this.triggersByType.get(triggerType);
  }

  /** @throws {UnknownComponentError} when no registered connector declares it. */
  getCredentialDefinition(credType: string): CredentialDefinition {
    const registered = this.credentialsByType.get(credType);
    if (!registered) throw new UnknownComponentError('credential', credType);
    return registered.definition;
  }

  findCredentialDefinition(credType: string): CredentialDefinition | undefined {
    return this.credentialsByType.get(credType)?.definition;
  }

  hasConnector(connectorId: string): boolean {
    return this.connectorsById.has(connectorId);
  }

  hasStep(stepType: string): boolean {
    return this.stepsByType.has(stepType);
  }

  hasTrigger(triggerType: string): boolean {
    return this.triggersByType.has(triggerType);
  }

  // ─── Listings ───

  listConnectors(): readonly BaseConnector[] {
    return Array.from(this.connectorsById.values());
  }

  /** Every step from every registered connector, each tagged with its owner. */
  listSteps(): readonly RegisteredStep[] {
    return Array.from(this.stepsByType.values());
  }

  listTriggers(): readonly RegisteredTrigger[] {
    return Array.from(this.triggersByType.values());
  }

  // ─── Catalogue (what the builder's palette and detail endpoints read) ───
  //
  // These answer the questions `StepRegistry` / `TriggerRegistry` used to. They
  // are here rather than in a fourth registry because a component cannot be
  // described without knowing its owner, and this is the only object that does.

  listStepSummaries(): StepSummary[] {
    return this.listSteps().map((r) => buildStepSummary(r.step));
  }

  /** @throws {UnknownComponentError} when no registered connector provides it. */
  getStepDescriptor(stepType: string): StepDescriptor {
    return buildStepDescriptor(this.getStep(stepType));
  }

  listTriggerSummaries(): TriggerSummary[] {
    return this.listTriggers().map((r) => buildTriggerSummary(r.trigger));
  }

  /** @throws {UnknownComponentError} when no registered connector provides it. */
  getTriggerDescriptor(triggerType: string): TriggerDescriptor {
    return buildTriggerDescriptor(this.getTrigger(triggerType));
  }

  /**
   * Every credential type, grouped by the connector that declares it, with the
   * form fields its shape needs. What the vault's create flow renders from.
   * Connectors that declare no credentials are omitted.
   */
  listCredentialTypes(): ConnectorCredentialTypes[] {
    return this.listConnectors()
      .filter((connector) => connector.credentials.length > 0)
      .map((connector) => ({
        connectorId: connector.id,
        connectorName: connector.name,
        credentials: connector.credentials.map((definition) => ({
          credType: definition.credType,
          label: definition.label,
          ...(definition.description !== undefined
            ? { description: definition.description }
            : {}),
          authType: definition.authType,
          fields:
            CREDENTIAL_AUTH_REGISTRY.find((entry) => entry.type === definition.authType)
              ?.fields ?? [],
        })),
      }));
  }



  // ─── Validation ───

  /**
   * Every reason this connector cannot be registered. Empty means valid.
   *
   * Pure: reads state, writes none. That is what makes atomic registration
   * possible — the caller can know the verdict before touching a map.
   */
  private findProblems(connector: BaseConnector): string[] {
    const problems: string[] = [];

    if (!connector.id) {
      problems.push('connector id must not be empty');
    }

    if (this.connectorsById.has(connector.id)) {
      problems.push(
        `connector id "${connector.id}" is already registered. ` +
          `Registering the same connector twice is usually a duplicated ` +
          `host wiring line.`,
      );
    }

    const declared = this.checkCredentials(connector, problems);
    this.checkSteps(connector, declared, problems);
    this.checkTriggers(connector, declared, problems);

    return problems;
  }


  /**
   * Validate the connector's credential declarations.
   *
   * @returns the types it declares — the authority for the component checks below.
   */
  private checkCredentials(
    connector: BaseConnector,
    problems: string[],
  ): ReadonlySet<string> {
    const declared = new Set<string>();
    for (const definition of connector.credentials) {
      if (!CREDENTIAL_TYPE_PATTERN.test(definition.credType)) {
        problems.push(
          `credential type "${definition.credType}" must be SCREAMING_SNAKE_CASE, ` +
            `e.g. "SLACK_BOT_TOKEN"`,
        );
      }
      // Ownership: a definition borrowed from another connector would let this
      // one claim a type that is not its own.
      if (definition.connectorId !== connector.id) {
        problems.push(
          `credential type "${definition.credType}" belongs to connector ` +
            `"${definition.connectorId}" but is declared by "${connector.id}"`,
        );
      }
      if (declared.has(definition.credType)) {
        problems.push(`credential type "${definition.credType}" is declared twice`);
      }
      declared.add(definition.credType);

      // Global uniqueness. The type is what stored credentials carry, so two
      // connectors answering to one type would make ownership ambiguous.
      const existing = this.credentialsByType.get(definition.credType);
      if (existing) {
        problems.push(
          `credential type "${definition.credType}" is already declared by connector ` +
            `"${existing.connectorId}". Prefix types with the connector name.`,
        );
      }
    }
    return declared;
  }

  private checkSteps(
    connector: BaseConnector,
    declaredCredentialTypes: ReadonlySet<string>,
    problems: string[],
  ): void {
    const seen = new Set<string>();

    for (const step of connector.steps) {
      if (!step.type) {
        problems.push(`step "${step.name}" has an empty type id`);
      }

      if (seen.has(step.type)) {
        problems.push(`step type "${step.type}" is declared twice`);
      }
      seen.add(step.type);

      // A step may only accept credential types its OWN connector declares.
      // This is what catches a step wired to a definition the connector forgot
      // to list: without it the credential picker would render empty and the
      // run would fail with "no credential configured", pointing at the user
      // rather than at the wiring.
      checkAcceptedCredentials(
        `step "${step.type}"`,
        step.credential,
        connector.id,
        declaredCredentialTypes,
        problems,
      );
      checkCredentialSlots(`step "${step.type}"`, step.credentialSlots, problems);
      checkOptionLoader(`step "${step.type}"`, step, problems);

      // Global uniqueness. Step type IDs are the key saved workflows store, so
      // two implementations answering to one ID means dispatch silently picks
      // whichever registered last. A boot failure is the only safe outcome.
      const existing = this.stepsByType.get(step.type);
      if (existing) {
        problems.push(
          `step type "${step.type}" is already registered by connector ` +
            `"${existing.connectorId}". Namespace new components as ` +
            `"<connector-id>.<action>".`,
        );
      }

    }
  }

  private checkTriggers(
    connector: BaseConnector,
    declaredCredentialTypes: ReadonlySet<string>,
    problems: string[],
  ): void {
    const seen = new Set<string>();

    for (const trigger of connector.triggers) {
      if (!trigger.type) {
        problems.push(`trigger "${trigger.name}" has an empty type id`);
      }

      if (seen.has(trigger.type)) {
        problems.push(`trigger type "${trigger.type}" is declared twice`);
      }
      seen.add(trigger.type);

      checkAcceptedCredentials(
        `trigger "${trigger.type}"`,
        trigger.credential,
        connector.id,
        declaredCredentialTypes,
        problems,
      );
      checkCredentialSlots(`trigger "${trigger.type}"`, trigger.credentialSlots, problems);
      checkOptionLoader(`trigger "${trigger.type}"`, trigger, problems);

      const existing = this.triggersByType.get(trigger.type);
      if (existing) {
        problems.push(
          `trigger type "${trigger.type}" is already registered by connector ` +
            `"${existing.connectorId}"`,
        );
      }

    }
  }

}


/**
 * A component may only accept credential types its OWN connector declares.
 *
 * Without this, a component wired to a definition its connector forgot to list
 * would render an empty credential picker and fail at run time with "no
 * credential configured", pointing at the user rather than at the wiring.
 */
function checkAcceptedCredentials(
  subject: string,
  accepted: readonly CredentialDefinition[] | undefined,
  connectorId: string,
  declared: ReadonlySet<string>,
  problems: string[],
): void {
  for (const definition of accepted ?? []) {
    if (declared.has(definition.credType)) continue;
    problems.push(
      `${subject} accepts credential type "${definition.credType}", which ` +
        `connector "${connectorId}" does not declare`,
    );
  }
}

function checkOptionLoader(
  subject: string,
  component: AnyStep | AnyTrigger,
  problems: string[],
): void {
  if (component.getOptions !== undefined) return;

  let offers = false;
  try {
    offers = schemaOffersOptions(zodToJsonSchemaRecord(component.configSchema));
  } catch {
    return;
  }

  if (offers) {
    problems.push(
      `${subject} wraps a config field in withOptions() but does not implement ` +
        `getOptions(). The editor would show a picker that can never load.`,
    );
  }
}

function checkCredentialSlots(
  subject: string,
  slots: readonly { readonly name: string }[] | undefined,
  problems: string[],
): void {
  const seen = new Set<string>();
  for (const slot of slots ?? []) {
    if (!slot.name) problems.push(`${subject} has a credential slot with an empty name`);
    if (seen.has(slot.name)) {
      problems.push(`${subject} declares credential slot "${slot.name}" twice`);
    }
    seen.add(slot.name);
  }
}

/** Owner facts written onto a registered component, for the palette. */
function stampOwner(target: AnyStep | AnyTrigger, connector: BaseConnector): void {
  const bag = target as { connectorId?: string; connectorName?: string; connectorIcon?: string };
  bag.connectorId = connector.id;
  bag.connectorName = connector.name;
  if (connector.icon !== undefined) bag.connectorIcon = connector.icon;
}
