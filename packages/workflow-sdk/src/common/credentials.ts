import { z } from 'zod';
import type { Action } from '../authz/types.js';
import type { ResourceAttributes } from '../authz/attributes.js';

export const CredentialStatusSchema = z.enum(['ACTIVE', 'REVOKED']);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

export type CredentialFieldControl = 'password' | 'text' | 'url';

export interface CredentialRegistryInputField {
  readonly key: string;
  readonly label: string;
  readonly control: CredentialFieldControl;
  /** Optional example hint shown as the input's placeholder. */
  readonly placeholder?: string;
}

export type CredentialRegistryEntryField = CredentialRegistryInputField;

interface CredentialRegistryEntryBase {
  readonly label: string;
  readonly fields: readonly CredentialRegistryEntryField[];
}

const credentialFieldMetadata = new WeakMap<
  z.ZodTypeAny,
  Omit<CredentialRegistryInputField, 'key'>
>();

function credentialField<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  metadata: Omit<CredentialRegistryInputField, 'key'>,
): TSchema {
  const describedSchema = schema.describe(metadata.label);
  credentialFieldMetadata.set(describedSchema, metadata);
  return describedSchema;
}

/**
 * Bearer token values.
 *
 * Runtime: `Authorization: Bearer <token>` is added to the request.
 */
export const BearerValuesSchema = z
  .object({
    token: credentialField(z.string().min(1), {
      label: 'Token',
      control: 'password',
    }),
  })
  .strict();

export type BearerValues = z.infer<typeof BearerValuesSchema>;

/**
 * HTTP Basic authentication values.
 *
 * Runtime: `Authorization: Basic base64(username:password)` is added.
 */
export const BasicValuesSchema = z
  .object({
    username: credentialField(z.string().min(1), {
      label: 'Username',
      control: 'text',
    }),
    password: credentialField(z.string().min(1), {
      label: 'Password',
      control: 'password',
    }),
  })
  .strict();

export type BasicValues = z.infer<typeof BasicValuesSchema>;

/**
 * Custom header values.
 *
 * Runtime: a single header `<name>: <value>` is added to the request.
 */
export const CustomHeaderValuesSchema = z
  .object({
    name: credentialField(z.string().min(1), {
      label: 'Header name',
      control: 'text',
      placeholder: 'e.g. X-Custom-Token',
    }),
    value: credentialField(z.string().min(1), {
      label: 'Header value',
      control: 'password',
      placeholder: 'The header value to send',
    }),
  })
  .strict();

export type CustomHeaderValues = z.infer<typeof CustomHeaderValuesSchema>;

/**
 * OAuth 2.0 client credentials values.
 */
export const OAuth2ClientCredentialsValuesSchema = z
  .object({
    tokenUrl: credentialField(z.string().url(), {
      label: 'Token URL',
      control: 'url',
    }),
    clientId: credentialField(z.string().min(1), {
      label: 'Client ID',
      control: 'text',
    }),
    clientSecret: credentialField(z.string().min(1), {
      label: 'Client Secret',
      control: 'password',
    }),
  })
  .strict();

export type OAuth2ClientCredentialsValues = z.infer<
  typeof OAuth2ClientCredentialsValuesSchema
>;

/**
 * A shared secret, such as a webhook signing secret.
 *
 * Runtime: never applied to an outbound request. The engine reads it to verify
 * that an inbound request was sent by the party holding the same value.
 */
export const SecretValuesSchema = z
  .object({
    value: credentialField(z.string().min(1), {
      label: 'Secret',
      control: 'password',
    }),
  })
  .strict();

export type SecretValues = z.infer<typeof SecretValuesSchema>;

/**
 * A service the engine calls: where it lives and the key it takes.
 *
 * Runtime: the key is sent as `Authorization: Bearer <key>`, and the step reads
 * `endpoint` to know where to send it — so moving between a vendor and a
 * self-hosted model of the same kind is a credential change, not a workflow edit.
 */
export const EndpointKeyValuesSchema = z
  .object({
    endpoint: credentialField(z.string().url(), {
      label: 'Endpoint',
      control: 'url',
      placeholder: 'https://api.example.com/v1/…',
    }),
    apiKey: credentialField(z.string().min(1), {
      label: 'API key',
      control: 'password',
    }),
  })
  .strict();

export type EndpointKeyValues = z.infer<typeof EndpointKeyValuesSchema>;

const EndpointKeyCredentialAuthSchema = z
  .object({
    authType: z.literal('endpoint_key'),
    values: EndpointKeyValuesSchema,
  })
  .strict()
  .describe('Endpoint & API key');

const BearerCredentialAuthSchema = z
  .object({
    authType: z.literal('bearer'),
    values: BearerValuesSchema,
  })
  .strict()
  .describe('Bearer Token');

const BasicCredentialAuthSchema = z
  .object({
    authType: z.literal('basic'),
    values: BasicValuesSchema,
  })
  .strict()
  .describe('Basic Auth');

const CustomHeaderCredentialAuthSchema = z
  .object({
    authType: z.literal('custom_header'),
    values: CustomHeaderValuesSchema,
  })
  .strict()
  .describe('Custom Header');

const OAuth2ClientCredentialsCredentialAuthSchema = z
  .object({
    authType: z.literal('oauth2_client_credentials'),
    values: OAuth2ClientCredentialsValuesSchema,
  })
  .strict()
  .describe('OAuth 2.0 Client Credentials');

const SecretCredentialAuthSchema = z
  .object({
    authType: z.literal('secret'),
    values: SecretValuesSchema,
  })
  .strict()
  .describe('Secret');

/**
 * Credential authentication is discriminated by `authType`, keeping each
 * authentication type paired with its exact values shape.
 */
export const CredentialAuthSchema = z.discriminatedUnion('authType', [
  BearerCredentialAuthSchema,
  BasicCredentialAuthSchema,
  CustomHeaderCredentialAuthSchema,
  OAuth2ClientCredentialsCredentialAuthSchema,
  SecretCredentialAuthSchema,
  EndpointKeyCredentialAuthSchema,
]);

export type CredentialAuth = z.infer<typeof CredentialAuthSchema>;

/**
 * The stored secret shapes, as a named list.
 *
 * A const object rather than a TypeScript `enum`: an enum's members are not
 * assignable from plain strings, and these values arrive as plain strings —
 * from the database, from an API body, from a workflow's stored config — so an
 * enum would force a cast at every one of those boundaries. This gives authors
 * `CredentialAuthType.Bearer` with autocomplete while `'bearer'` keeps working.
 *
 * Kept in step with {@link CredentialAuthSchema} by the type below: the union
 * is derived from the schema, so a member added here without a schema variant
 * (or the reverse) fails to compile.
 */
export const CredentialAuthType = {
  Bearer: 'bearer',
  Basic: 'basic',
  CustomHeader: 'custom_header',
  OAuth2ClientCredentials: 'oauth2_client_credentials',
  Secret: 'secret',
  EndpointKey: 'endpoint_key',
} as const satisfies Record<string, CredentialAuth['authType']>;

export type CredentialAuthType = CredentialAuth['authType'];

export type AuthSpecificValues = CredentialAuth['values'];

/**
 * Per-auth-type value schemas, extracted from the discriminated union.
 */
export const CREDENTIAL_VALUE_SCHEMAS = Object.fromEntries(
  CredentialAuthSchema.options.map((option) => [
    option.shape.authType.value,
    option.shape.values,
  ]),
) as unknown as Record<CredentialAuthType, z.ZodTypeAny>;

export function validateCredentialAuth(
  authType: CredentialAuthType,
  values: unknown,
): CredentialAuth {
  return CredentialAuthSchema.parse({ authType, values });
}

export function validateCredentialValues(
  authType: CredentialAuthType,
  values: unknown,
): AuthSpecificValues {
  return validateCredentialAuth(authType, values).values;
}

export const CredentialNameSchema = z.string().min(1).max(255);

export interface CredentialSummary {
  readonly name: string;
  /**
   * The connector-declared credential type, e.g. `GITHUB_WEBHOOK_SECRET`.
   * Decides which steps and triggers may use it.
   */
  readonly credType: string;
  /** The stored shape. Decides the form and how the value is applied. */
  readonly authType: CredentialAuthType;
  readonly status: CredentialStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ResolvedCredential = Readonly<{
  name: string;
  credType: string;
  status: CredentialStatus;
}> &
  Readonly<CredentialAuth>;

/**
 * Apply an already-resolved credential to HTTP request headers.
 *
 * Credential resolution belongs to the executor/runtime. This shared helper
 * only translates the validated credential value into its HTTP representation,
 * so workflow steps and server-side credential testing use identical logic.
 */
export function applyResolvedCredentialAuth(
  headers: Headers,
  credential: ResolvedCredential,
): void {
  switch (credential.authType) {
    case 'bearer': {
      const { token } = credential.values;
      headers.set('authorization', `Bearer ${token}`);
      break;
    }
    case 'basic': {
      const { username, password } = credential.values;
      headers.set('authorization', `Basic ${btoa(`${username}:${password}`)}`);
      break;
    }
    case 'custom_header': {
      const { name, value } = credential.values;
      headers.set(name, value);
      break;
    }
    case 'oauth2_client_credentials': {
      throw new Error(
        'oauth2_client_credentials is not yet supported for HTTP requests',
      );
    }
    case 'secret': {
      throw new Error(
        `Credential "${credential.name}" is a secret for verifying inbound requests ` +
          'and cannot authenticate an outbound request',
      );
    }
    case 'endpoint_key': {
      const { apiKey } = credential.values;
      headers.set('authorization', `Bearer ${apiKey}`);
      break;
    }
  }
}

/** The values of one shape, e.g. `{ value: string }` for `'secret'`. */
export type CredentialValuesOf<T extends CredentialAuthType> = Extract<
  CredentialAuth,
  { authType: T }
>['values'];

/**
 * The values of a resolved credential, narrowed to the shape the caller expects.
 *
 *     const { value: secret } = credentialValues(ctx.credentials, 'webhookSecret', 'secret');
 *
 * Throws when the slot resolved nothing or holds another shape. Both are wiring
 * mistakes rather than user input, since the resolver has already checked the
 * credential's type against what the component accepts.
 */
export function credentialValues<T extends CredentialAuthType>(
  credentials: Readonly<Record<string, ResolvedCredential>>,
  slot: string,
  authType: T,
): CredentialValuesOf<T> {
  const credential = credentials[slot];
  if (!credential) {
    throw new Error(`No credential was resolved for slot "${slot}"`);
  }
  if (credential.authType !== authType) {
    throw new Error(
      `Credential "${credential.name}" in slot "${slot}" is ${credential.authType}, not ${authType}`,
    );
  }
  // The check above established the shape; the compiler cannot follow a
  // narrowing on a generic union, so the cast states what the check proved.
  return credential.values as unknown as CredentialValuesOf<T>;
}

/**
 * What a client sends to create a credential.
 *
 * Carries the credential TYPE, never the shape: the server looks the type up
 * in the connector registry and takes the shape from its definition, so a
 * client cannot store a `GITHUB_WEBHOOK_SECRET` with bearer values.
 */
export interface CreateCredentialRequest {
  readonly name: string;
  readonly credType: string;
  readonly values: unknown;
}

/** What persistence receives: the request, validated and resolved to its shape. */
export type CreateCredentialInput = Readonly<{ name: string; credType: string }> &
  Readonly<CredentialAuth>;

export interface ReplaceCredentialValuesInput {
  readonly values: AuthSpecificValues;
}

/**
 * One safe credential row returned by list operations.
 *
 * `summary` is the SDK-owned credential shape. `attributes` is the host-owned,
 * typed metadata carried opaquely by the SDK. `permittedActions` is projected
 * by the runtime so UIs can gate row actions without knowing host policy.
 */
export interface CredentialListItem {
  readonly summary: CredentialSummary;
  readonly attributes?: ResourceAttributes<'credential'>;
  readonly permittedActions?: readonly Action[];
}

export interface CredentialListResponse {
  readonly credentials: CredentialListItem[];
  /**
   * Cursor for the next page — the last returned credential's name. Absent when
   * this was the last page.
   */
  readonly nextCursor?: string;
}

export interface CredentialRegistryEntry extends CredentialRegistryEntryBase {
  readonly type: CredentialAuthType;
}

function extractRegistryFields(
  schema: z.AnyZodObject,
): CredentialRegistryEntryField[] {
  return Object.entries(schema.shape).map(([key, fieldSchema]) => {
    const metadata = credentialFieldMetadata.get(fieldSchema as z.ZodTypeAny);
    if (!metadata) {
      throw new Error(`Credential field "${key}" is missing UI metadata`);
    }
    return { key, ...metadata };
  });
}

/**
 * Minimal registry for host-rendered credential forms. Entries and field keys
 * are extracted from CredentialAuthSchema; Zod remains the source of truth.
 */
export const CREDENTIAL_AUTH_REGISTRY: readonly CredentialRegistryEntry[] =
  CredentialAuthSchema.options.map((option) => ({
    type: option.shape.authType.value,
    label: option.description ?? option.shape.authType.value,
    fields: extractRegistryFields(option.shape.values),
  }));

/** A credential type named for display: what a component accepts. */
export interface CredentialTypeRef {
  readonly credType: string;
  readonly label: string;
}

/** One credential type a connector offers, as the vault's create flow needs it. */
export interface CredentialTypeDescriptor {
  readonly credType: string;
  readonly label: string;
  readonly description?: string;
  readonly authType: CredentialAuthType;
  readonly fields: readonly CredentialRegistryEntryField[];
}

/** The credential types of one connector, for grouping in the vault. */
export interface ConnectorCredentialTypes {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly credentials: readonly CredentialTypeDescriptor[];
}
