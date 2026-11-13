/**
 * What a connector declares about its credentials, and what a component accepts.
 *
 * ─── Type and shape are different things ───
 *
 * A credential has a TYPE and a SHAPE.
 *
 * - The type, `credType`, is the connector's own enum value — `SLACK_BOT_TOKEN`,
 *   `GITHUB_WEBHOOK_SECRET`. It says who owns the credential and what it is for,
 *   and it is what compatibility is checked on: a Slack step lists only Slack
 *   credentials, even though a Jira token has the same shape.
 * - The shape, `authType`, is one of the framework's small fixed set
 *   ({@link CredentialAuthType}). It decides how values are stored, which form
 *   the vault renders, and how the value is applied to an outbound request.
 *
 * A definition binds one type to one shape, and a stored credential carries both.
 *
 * ─── Definitions are referenced, not retyped ───
 *
 * Components refer to the DEFINITION OBJECT rather than repeating the type as
 * text, so a typo is a compile error rather than a boot error:
 *
 *     export const SLACK_BOT_TOKEN = defineCredential({
 *       connectorId: 'slack', credType: 'SLACK_BOT_TOKEN',
 *       label: 'Bot token', authType: CredentialAuthType.Bearer,
 *     });
 *
 *     override readonly credential = [SLACK_BOT_TOKEN];   // not ['SLACK_BOT_TOKEN']
 */

import type { CredentialAuthType } from '../../common/credentials.js';
import type { AnyStep } from './base-connector.js';

/**
 * The format a `credType` must follow: SCREAMING_SNAKE_CASE, the way the
 * framework's other enums read. Checked by the registry at boot.
 */
export const CREDENTIAL_TYPE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * One credential type a connector offers. Build with {@link defineCredential}.
 *
 * Generic over the OWNING CONNECTOR'S ID so the owner survives in the type:
 * a definition owned by `acme` and one owned by `other` are different types,
 * which is what lets {@link declareSteps} reject a step reaching for another
 * connector's credential without running anything.
 */
export interface CredentialDefinition<TConnector extends string = string> {
  /** The connector's enum value, e.g. `'SLACK_BOT_TOKEN'`. Globally unique. */
  readonly credType: string;
  /** The connector that owns it, for the registry's ownership check. */
  readonly connectorId: TConnector;
  /** Human label for the vault, e.g. `"Bot token"`. */
  readonly label: string;
  /** Where to find or how to choose the value. Shown when creating one. */
  readonly description?: string;
  /** The stored shape. Drives the vault's form and outbound application. */
  readonly authType: CredentialAuthType;
}

/** Declare a credential type. Frozen, so every component holds the same object. */
export function defineCredential<TConnector extends string>(input: {
  connectorId: TConnector;
  credType: string;
  label: string;
  description?: string;
  authType: CredentialAuthType;
}): CredentialDefinition<TConnector> {
  return Object.freeze({
    credType: input.credType,
    connectorId: input.connectorId,
    label: input.label,
    ...(input.description !== undefined ? { description: input.description } : {}),
    authType: input.authType,
  });
}

/**
 * The credential types a component accepts — the definitions themselves.
 *
 * Empty means "authenticates nothing", which is most components. This says
 * WHICH types are acceptable, not WHETHER one is needed: that stays with
 * `credentialSlots`, because HTTP_REQUEST accepts several types while needing
 * none.
 */
export type CredentialRequirement = readonly CredentialDefinition[];

/** A component that authenticates nothing — a CODE step, a LOOP step. */
export const NO_CREDENTIAL: CredentialRequirement = [];

/** Can a stored credential of this type satisfy the requirement? */
export function acceptsCredential(
  requirement: CredentialRequirement,
  credType: string,
): boolean {
  return requirement.some((definition) => definition.credType === credType);
}

/**
 * A step, narrowed to the credential types one connector offers.
 *
 * `AnyStep` erases each step's credential types, which is what lets a registry
 * hold steps from every connector in one map — and also what stops the compiler
 * from noticing a step reaching for a credential its connector never declared.
 * This type puts that information back for the one moment it matters: when a
 * connector lists the steps it owns.
 */
export type StepAccepting<TCredential extends CredentialDefinition> =
  Omit<AnyStep, 'credential'> & {
    readonly credential?: readonly TCredential[];
  };

/**
 * Declare a connector's steps, checked against its credentials AT COMPILE TIME.
 *
 *     override readonly credentials = BUILTIN_CREDENTIALS;
 *     override readonly steps = declareSteps(BUILTIN_CREDENTIALS, [
 *       new HttpRequestStep(),   // accepts builtin types — fine
 *       new ForeignStep(),       // accepts another connector's type — red squiggle
 *     ]);
 *
 * The registry makes the same check at boot, because a step whose `credential`
 * is typed as the wide `CredentialDefinition[]` has no literal types left to
 * compare.
 */
export function declareSteps<TCredential extends CredentialDefinition>(
  _credentials: readonly TCredential[],
  steps: readonly StepAccepting<TCredential>[],
): readonly AnyStep[] {
  return steps as readonly AnyStep[];
}
