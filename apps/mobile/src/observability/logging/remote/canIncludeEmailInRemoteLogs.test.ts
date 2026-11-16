import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canIncludeEmailInRemoteLogs } from './canIncludeEmailInRemoteLogs';

const PROD_ORIGIN = 'https://example.org';
const SANDBOX_ORIGIN = 'https://sandbox.example.org';
const COMMUNITY_ORIGIN = 'https://spaces.xyne.ai';

describe('canIncludeEmailInRemoteLogs', () => {
  it('allows email on the matching first-party Godel endpoint in release builds', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs(`${PROD_ORIGIN}/godel/events`, 'prod', false, PROD_ORIGIN),
      true,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        `${SANDBOX_ORIGIN}/godel/events`,
        'sandbox',
        false,
        SANDBOX_ORIGIN,
      ),
      true,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        `${COMMUNITY_ORIGIN}/godel/events`,
        'community',
        false,
        COMMUNITY_ORIGIN,
      ),
      true,
    );
  });

  it('keeps each variant on its own host', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs(`${COMMUNITY_ORIGIN}/godel/events`, 'prod', false, PROD_ORIGIN),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        `${PROD_ORIGIN}/godel/events`,
        'community',
        false,
        COMMUNITY_ORIGIN,
      ),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(`${PROD_ORIGIN}/godel/events`, 'prod', false, ''),
      false,
    );
  });

  it('does not allow email in development, on a mismatched host, or to another endpoint', () => {
    assert.equal(
      canIncludeEmailInRemoteLogs(`${PROD_ORIGIN}/godel/events`, 'prod', true, PROD_ORIGIN),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(`${PROD_ORIGIN}/godel/events`, 'dev', false, PROD_ORIGIN),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        'https://attacker.example/godel/events',
        'prod',
        false,
        PROD_ORIGIN,
      ),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs('http://example.org/godel/events', 'prod', false, PROD_ORIGIN),
      false,
    );
    assert.equal(
      canIncludeEmailInRemoteLogs(
        `${PROD_ORIGIN}/godel/events?forward=attacker.example`,
        'prod',
        false,
        PROD_ORIGIN,
      ),
      false,
    );
  });
});
