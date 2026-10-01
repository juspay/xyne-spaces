import { isSensitiveKey, redactSensitiveFields, redactSensitiveUrl, TRUNCATED_VALUE } from './redact';

const CANARY = 'canary-secret-7f3a9c';

describe('redactSensitiveUrl', () => {
  it.each([
    [`/api/automation-webhooks/series_1/${CANARY}`, '/api/automation-webhooks/series_1/[REDACTED]'],
    [`/api/automation-webhooks/series_1/${CANARY}?x=1`, '/api/automation-webhooks/series_1/[REDACTED]?x=1'],
    [`/api/apps/webhooks/ws_1/app_1/${CANARY}`, '/api/apps/webhooks/ws_1/app_1/[REDACTED]'],
    [`/api/apps/webhooks/sentinel/ws_1/app_1/${CANARY}`, '/api/apps/webhooks/sentinel/ws_1/app_1/[REDACTED]'],
    [`/api/apps/webhooks/sns/ws_1/app_1/${CANARY}`, '/api/apps/webhooks/sns/ws_1/app_1/[REDACTED]'],
    [`/api/apps/webhooks/pingdom/ws_1/app_1/${CANARY}`, '/api/apps/webhooks/pingdom/ws_1/app_1/[REDACTED]'],
    [`/api/apps/webhooks/gcp/ws_1/app_1/${CANARY}?auth=x`, '/api/apps/webhooks/gcp/ws_1/app_1/[REDACTED]?auth=x'],
    // Router-relative form, as seen by middleware mounted under /api.
    [`/apps/webhooks/ws_1/app_1/${CANARY}`, '/apps/webhooks/ws_1/app_1/[REDACTED]'],
  ])('redacts the secret segment of %s', (input, expected) => {
    expect(redactSensitiveUrl(input)).toBe(expected);
    expect(redactSensitiveUrl(input)).not.toContain(CANARY);
  });

  it('leaves non-secret URLs unchanged', () => {
    expect(redactSensitiveUrl('/api/apps/incoming-webhooks/wh_1/revoke')).toBe(
      '/api/apps/incoming-webhooks/wh_1/revoke',
    );
    expect(redactSensitiveUrl('/api/channels/c1/messages')).toBe('/api/channels/c1/messages');
  });

  it('handles empty input', () => {
    expect(redactSensitiveUrl(undefined)).toBe('');
    expect(redactSensitiveUrl(null)).toBe('');
  });
});

describe('isSensitiveKey', () => {
  it.each([
    'secret',
    'Secret',
    'client_state',
    'clientState',
    'api-key',
    'apiKey',
    'Authorization',
    'accessToken',
    // Common HTTP header spellings (e.g. axios error.response.headers).
    'x-api-key',
    'X-Api-Key',
    'set-cookie',
    'Set-Cookie',
    'proxy-authorization',
    'x-auth-token',
    'signingSecret',
    'signing_secret',
    'authToken',
    'sessionToken',
    'apiSecret',
    'bearer',
  ])(
    'treats %s as sensitive',
    (key) => expect(isSensitiveKey(key)).toBe(true),
  );

  it.each(['tokenCount', 'hasToken', 'webhookId', 'subscriptionId', 'secretLength'])(
    'does not treat %s as sensitive',
    (key) => expect(isSensitiveKey(key)).toBe(false),
  );
});

describe('redactSensitiveFields', () => {
  it('redacts sensitive keys at any depth without mutating the input', () => {
    const input = {
      params: { workspaceId: 'ws_1', appId: 'app_1', secret: CANARY },
      nested: [{ clientState: CANARY, id: 'n1' }],
      ok: 'value',
    };
    const out = redactSensitiveFields(input);

    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(out.params.workspaceId).toBe('ws_1');
    expect(out.nested[0].id).toBe('n1');
    expect(out.ok).toBe('value');
    expect(input.params.secret).toBe(CANARY);
  });

  it('returns the same reference when nothing is sensitive', () => {
    const input = { a: 1, b: { c: 'd' } };
    expect(redactSensitiveFields(input)).toBe(input);
  });

  it('survives circular references', () => {
    const input: Record<string, unknown> = { secret: CANARY };
    input.self = input;
    const out = redactSensitiveFields(input);
    expect(out.secret).toBe('[REDACTED]');
    // The cycle must resolve to the redacted copy, not the original.
    expect(out.self).toBe(out);
    expect((out.self as Record<string, unknown>).secret).toBe('[REDACTED]');
    expect(input.secret).not.toBe('[REDACTED]');
  });

  it('does not leak through an indirect cycle back to a redacted ancestor', () => {
    const parent: Record<string, unknown> = { token: CANARY };
    parent.child = { meta: { back: parent } };
    const out = redactSensitiveFields(parent);
    expect(JSON.stringify(out, (key, v: unknown) => (key !== '' && v === out ? undefined : v))).not.toContain(CANARY);
    const child = out.child as { meta: { back: Record<string, unknown> } };
    expect(child.meta.back.token).toBe('[REDACTED]');
  });

  it('truncates containers deeper than the redaction depth instead of passing them through', () => {
    let deep: Record<string, unknown> = { secret: CANARY };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const out = redactSensitiveFields(deep);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(JSON.stringify(out)).toContain(TRUNCATED_VALUE);
  });
});
