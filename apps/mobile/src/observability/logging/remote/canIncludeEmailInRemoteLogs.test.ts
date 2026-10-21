import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canIncludeEmailInRemoteLogs } from './canIncludeEmailInRemoteLogs';

describe('canIncludeEmailInRemoteLogs', () => {
  it('allows email on the matching first-party Godel endpoint in release builds', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs('https://spaces.xyne.juspay.net/godel/events', 'prod', false),
      true,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        'https://spaces.sandbox.xyne.juspay.net/godel/events',
        'sandbox',
        false,
      ),
      true,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs('https://spaces.xyne.ai/godel/events', 'community', false),
      true,
    );
  });

  it('keeps each variant on its own host', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs('https://spaces.xyne.ai/godel/events', 'prod', false),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        'https://spaces.xyne.juspay.net/godel/events',
        'community',
        false,
      ),
      false,
    );
  });

  it('does not allow email in development, on a mismatched host, or to another endpoint', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs('https://spaces.xyne.juspay.net/godel/events', 'prod', true),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs('https://spaces.xyne.juspay.net/godel/events', 'dev', false),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs('https://attacker.example/godel/events', 'prod', false),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs('http://spaces.xyne.juspay.net/godel/events', 'prod', false),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        'https://spaces.xyne.juspay.net/godel/events?forward=attacker.example',
        'prod',
        false,
      ),
      false,
    );
  });
});
