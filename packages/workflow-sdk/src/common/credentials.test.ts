import { describe, expect, it } from 'vitest';
import {
  applyResolvedCredentialAuth,
  credentialValues,
  BasicValuesSchema,
  BearerValuesSchema,
  CREDENTIAL_AUTH_REGISTRY,
  CREDENTIAL_VALUE_SCHEMAS,
  CredentialAuthSchema,
  CredentialNameSchema,
  CredentialStatusSchema,
  CustomHeaderValuesSchema,
  OAuth2ClientCredentialsValuesSchema,
  validateCredentialAuth,
  validateCredentialValues,
} from './credentials.js';
import type {
  AuthSpecificValues,
  CredentialAuth,
  CredentialSummary,
} from './credentials.js';

const validCredentials = [
  { authType: 'bearer' as const, values: { token: 'token' } },
  {
    authType: 'basic' as const,
    values: { username: 'user', password: 'password' },
  },
  {
    authType: 'custom_header' as const,
    values: { name: 'X-Secret', value: 'secret' },
  },
  {
    authType: 'oauth2_client_credentials' as const,
    values: {
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'client',
      clientSecret: 'secret',
    },
  },
  { authType: 'secret' as const, values: { value: 'shared-secret' } },
  {
    authType: 'endpoint_key' as const,
    values: { endpoint: 'https://api.example.com/v1/systemone', apiKey: 'key' },
  },
] satisfies CredentialAuth[];

describe('credential schemas', () => {
  it.each(['ACTIVE', 'REVOKED'] as const)('accepts status %s', (status) => {
    expect(CredentialStatusSchema.parse(status)).toBe(status);
  });

  it('validates each remaining values schema strictly', () => {
    expect(BearerValuesSchema.parse({ token: 'token' })).toEqual({ token: 'token' });
    expect(BasicValuesSchema.parse({ username: 'user', password: 'password' })).toEqual({
      username: 'user',
      password: 'password',
    });
    expect(CustomHeaderValuesSchema.parse({ name: 'X-Secret', value: 'secret' })).toEqual({
      name: 'X-Secret',
      value: 'secret',
    });
    expect(
      OAuth2ClientCredentialsValuesSchema.parse({
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).toBeTruthy();
    expect(BearerValuesSchema.safeParse({ token: '', extra: true }).success).toBe(false);
  });

  it.each(validCredentials)(
    'accepts $authType with its matching values',
    (credentialAuth) => {
      expect(CredentialAuthSchema.parse(credentialAuth)).toEqual(credentialAuth);
      expect(
        validateCredentialAuth(credentialAuth.authType, credentialAuth.values),
      ).toEqual(credentialAuth);
    },
  );

  it('rejects mismatched values and the removed api_key type', () => {
    expect(
      CredentialAuthSchema.safeParse({
        authType: 'bearer',
        values: { username: 'user', password: 'password' },
      }).success,
    ).toBe(false);
    expect(
      CredentialAuthSchema.safeParse({
        authType: 'api_key',
        values: { key: 'secret', name: 'X-Key', placement: 'header' },
      }).success,
    ).toBe(false);
  });

  it('returns only values from validateCredentialValues', () => {
    expect(validateCredentialValues('bearer', { token: 'token' })).toEqual({
      token: 'token',
    });
  });
});

describe('CredentialNameSchema', () => {
  it('accepts 1 through 255 characters and rejects other lengths', () => {
    expect(CredentialNameSchema.parse('credential')).toBe('credential');
    expect(CredentialNameSchema.parse('x'.repeat(255))).toHaveLength(255);
    expect(CredentialNameSchema.safeParse('').success).toBe(false);
    expect(CredentialNameSchema.safeParse('x'.repeat(256)).success).toBe(false);
  });
});

describe('derived credential registries', () => {
  const authTypes = validCredentials.map(({ authType }) => authType);

  it('derives schemas and UI entries from the discriminated union', () => {
    expect(Object.keys(CREDENTIAL_VALUE_SCHEMAS)).toEqual(authTypes);
    expect(CREDENTIAL_AUTH_REGISTRY.map(({ type }) => type)).toEqual(authTypes);
  });

  it('derives field keys from each option value schema', () => {
    for (const entry of CREDENTIAL_AUTH_REGISTRY) {
      expect(entry.fields.map(({ key }) => key)).toEqual(
        Object.keys(CREDENTIAL_VALUE_SCHEMAS[entry.type].shape),
      );
    }
  });

  it('exposes no select control', () => {
    const controls = CREDENTIAL_AUTH_REGISTRY.flatMap(({ fields }) =>
      fields.map(({ control }) => control),
    );
    expect(controls).not.toContain('select');
    expect(new Set(controls)).toEqual(new Set(['password', 'text', 'url']));
  });
});

describe('public credential types', () => {
  it('keeps values and host actor fields out of CredentialSummary', () => {
    const summary: CredentialSummary = {
      name: 'credential',
      credType: 'BUILTIN_BEARER',
      authType: 'bearer',
      status: 'ACTIVE',
      createdAt: 1,
      updatedAt: 2,
    };
    expect(summary).not.toHaveProperty('values');
    expect(summary).not.toHaveProperty('createdBy');
    expect(summary).not.toHaveProperty('updatedBy');
  });

  it('accepts every AuthSpecificValues shape', () => {
    const values: AuthSpecificValues[] = validCredentials.map(({ values }) => values);
    expect(values).toHaveLength(6);
  });
});

describe('applyResolvedCredentialAuth', () => {
  it('refuses to put a secret on an outbound request', () => {
    expect(() =>
      applyResolvedCredentialAuth(new Headers(), {
        name: 'signing',
        credType: 'TEST_WEBHOOK_SECRET',
        status: 'ACTIVE',
        authType: 'secret',
        values: { value: 's' },
      }),
    ).toThrow(/cannot authenticate an outbound request/);
  });
});

describe('credentialValues', () => {
  const credentials = {
    signing: {
      name: 'hook-secret',
      credType: 'TEST_WEBHOOK_SECRET',
      status: 'ACTIVE' as const,
      authType: 'secret' as const,
      values: { value: 'shh' },
    },
  };

  it('returns the slot’s values narrowed to the expected shape', () => {
    const { value } = credentialValues(credentials, 'signing', 'secret');
    expect(value).toBe('shh');
  });

  it('throws for a slot that resolved nothing, naming the slot', () => {
    expect(() => credentialValues(credentials, 'missing', 'secret')).toThrow(
      'No credential was resolved for slot "missing"',
    );
  });

  it('throws for a credential of another shape', () => {
    expect(() => credentialValues(credentials, 'signing', 'bearer')).toThrow(
      'Credential "hook-secret" in slot "signing" is secret, not bearer',
    );
  });
});
