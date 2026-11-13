// The connector contract: what a connector is, and the registry that holds them.
export { BaseConnector } from './base-connector.js';
export type { AnyStep, AnyTrigger } from './base-connector.js';

export {
  ConnectorRegistry,
  ConnectorRegistrationError,
  UnknownComponentError,
} from './connector-registry.js';
export type {
  RegisteredStep,
  RegisteredTrigger,
  RegisteredCredential,
} from './connector-registry.js';

export {
  defineCredential,
  acceptsCredential,
  declareSteps,
  NO_CREDENTIAL,
  CREDENTIAL_TYPE_PATTERN,
} from './credentials.js';
export type { CredentialDefinition, CredentialRequirement } from './credentials.js';
