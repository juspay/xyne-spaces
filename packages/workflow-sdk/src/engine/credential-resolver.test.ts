import { describe, it, expect } from 'vitest';
import { CredentialResolver, CredentialResolutionError } from './credential-resolver.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { defineCredential } from '../connectors/core/credentials.js';

const GITHUB_SECRET = defineCredential({
  connectorId: 'github',
  credType: 'GITHUB_WEBHOOK_SECRET',
  label: 'Webhook secret',
  authType: 'secret',
});

function setup() {
  const persistence = new InMemoryPersistenceAdapter();
  persistence.seedCredential('gh', {
    credType: 'GITHUB_WEBHOOK_SECRET',
    authType: 'secret',
    values: { value: 's' },
  });
  persistence.seedCredential('generic', { authType: 'secret', values: { value: 's' } });
  persistence.seedCredential('old', { credType: 'GITHUB_WEBHOOK_SECRET', authType: 'secret', values: { value: 's' }, status: 'REVOKED' });
  return new CredentialResolver(persistence);
}

const required = { credentialSlots: [{ name: 'secretName', required: true }], credential: [GITHUB_SECRET] };
const optional = { credentialSlots: [{ name: 'secretName', required: false }], credential: [GITHUB_SECRET] };

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CredentialResolutionError);
    return (err as CredentialResolutionError).reason;
  }
  throw new Error('expected resolution to fail');
}

describe('CredentialResolver', () => {
  it('resolves a configured slot to a credential of an accepted type, keyed by slot', async () => {
    const resolved = await setup().resolve({}, required, { secretName: 'gh' });
    expect(resolved['secretName']).toMatchObject({ name: 'gh', credType: 'GITHUB_WEBHOOK_SECRET' });
  });

  it('fails a required slot left empty', async () => {
    expect(await reasonOf(setup().resolve({}, required, {}))).toBe('unset');
  });

  it('omits an optional slot left empty', async () => {
    expect(await setup().resolve({}, optional, { secretName: '' })).toEqual({});
  });

  it('fails a slot that did not resolve to a name', async () => {
    expect(await reasonOf(setup().resolve({}, required, { secretName: 42 }))).toBe('not-a-name');
  });

  it('fails a missing or revoked credential, naming it', async () => {
    const resolver = setup();
    await expect(resolver.resolve({}, required, { secretName: 'ghost' })).rejects.toThrow(
      'Required credential "ghost" not found',
    );
    expect(await reasonOf(resolver.resolve({}, required, { secretName: 'old' }))).toBe('not-found');
  });

  it('fails a credential of the same shape but another type', async () => {
    expect(await reasonOf(setup().resolve({}, required, { secretName: 'generic' }))).toBe('wrong-type');
  });

  it('takes any type when the consumer accepts none in particular', async () => {
    const anyType = { credentialSlots: [{ name: 'secretName', required: true }] };
    expect(await setup().resolve({}, anyType, { secretName: 'generic' })).toHaveProperty('secretName');
  });

  it('records which slot failed', async () => {
    try {
      await setup().resolve({}, required, {});
    } catch (err) {
      expect((err as CredentialResolutionError).slot).toBe('secretName');
    }
  });
});
