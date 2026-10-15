import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { parseRemoteLoggingEnabled } from '@/src/observability/logging/config/parseRemoteLoggingEnabled';

const ENV_TEMPLATE = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

describe('parseRemoteLoggingEnabled', () => {
  it('defaults to off for dev and debug builds', () => {
    assert.equal(
      parseRemoteLoggingEnabled(undefined, {
        isDevBuild: true,
        isProductionVariant: false,
      }),
      false,
    );

    assert.equal(
      parseRemoteLoggingEnabled(undefined, {
        isDevBuild: true,
        isProductionVariant: true,
      }),
      false,
    );
  });

  it('defaults to on only for production release builds', () => {
    assert.equal(
      parseRemoteLoggingEnabled(undefined, {
        isDevBuild: false,
        isProductionVariant: true,
      }),
      true,
    );

    assert.equal(
      parseRemoteLoggingEnabled(undefined, {
        isDevBuild: false,
        isProductionVariant: false,
      }),
      false,
    );
  });

  it('honours explicit true/false overrides from app.config extra', () => {
    assert.equal(
      parseRemoteLoggingEnabled('true', {
        isDevBuild: true,
        isProductionVariant: false,
      }),
      true,
    );

    assert.equal(
      parseRemoteLoggingEnabled('false', {
        isDevBuild: false,
        isProductionVariant: true,
      }),
      false,
    );
  });

  it('keeps the public environment template opt-in for diagnostics', () => {
    assert.match(ENV_TEMPLATE, /^WEBVIEW_DEBUGGING_ENABLED=false$/m);
    assert.match(ENV_TEMPLATE, /^LOTUS_REMOTE_LOGGING_ENABLED=false$/m);
  });
});
