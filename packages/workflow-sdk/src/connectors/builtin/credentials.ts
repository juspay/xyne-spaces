/**
 * The credential types the built-in connector offers.
 *
 * These are the connector-less shapes an HTTP request can authenticate with — a
 * token, a username/password, a header, or a client-credentials exchange. They
 * belong to `builtin` because that is the connector whose step uses them; a
 * provider connector declares its own instead.
 *
 * Each type is named `BUILTIN_<SHAPE>`. A host backfilling credentials stored
 * before types existed maps each old shape to the type of the same name.
 */

import { defineCredential } from '../core/credentials.js';
import { CredentialAuthType } from '../../common/credentials.js';

const BUILTIN = 'builtin';

export const BUILTIN_BEARER = defineCredential({
  connectorId: BUILTIN,
  credType: 'BUILTIN_BEARER',
  label: 'Bearer Token',
  description: 'A single token sent as an Authorization: Bearer header.',
  authType: CredentialAuthType.Bearer,
});

export const BUILTIN_BASIC = defineCredential({
  connectorId: BUILTIN,
  credType: 'BUILTIN_BASIC',
  label: 'Basic Auth',
  description: 'A username and password (HTTP Basic auth).',
  authType: CredentialAuthType.Basic,
});

export const BUILTIN_CUSTOM_HEADER = defineCredential({
  connectorId: BUILTIN,
  credType: 'BUILTIN_CUSTOM_HEADER',
  label: 'Custom Header',
  description: 'A custom header name and value.',
  authType: CredentialAuthType.CustomHeader,
});

export const BUILTIN_OAUTH2_CLIENT_CREDENTIALS = defineCredential({
  connectorId: BUILTIN,
  credType: 'BUILTIN_OAUTH2_CLIENT_CREDENTIALS',
  label: 'OAuth 2.0 Client Credentials',
  description: 'Client ID and secret exchanged for a token on each request.',
  authType: CredentialAuthType.OAuth2ClientCredentials,
});

/**
 * A service the engine calls — where it is and the key it takes. The classifier
 * step reads both from here, so swapping the model it asks is a credential
 * change rather than an edit to every workflow that uses it.
 */
export const BUILTIN_ENDPOINT_KEY = defineCredential({
  connectorId: BUILTIN,
  credType: 'BUILTIN_ENDPOINT_KEY',
  label: 'Endpoint & API key',
  description: 'The address of a service and the key it takes, e.g. a classifier model.',
  authType: CredentialAuthType.EndpointKey,
});

/** Every shape an HTTP request can authenticate with. */
export const BUILTIN_CREDENTIALS = [
  BUILTIN_BEARER,
  BUILTIN_BASIC,
  BUILTIN_CUSTOM_HEADER,
  BUILTIN_OAUTH2_CLIENT_CREDENTIALS,
] as const;

/** Everything the built-in connector offers: the HTTP shapes, and a service to call. */
export const BUILTIN_ALL_CREDENTIALS = [...BUILTIN_CREDENTIALS, BUILTIN_ENDPOINT_KEY] as const;
