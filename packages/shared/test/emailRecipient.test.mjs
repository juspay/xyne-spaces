import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output: the module consumers actually resolve.
import {
  isValidRecipientAddress,
  findInvalidRecipients,
  extractRecipientAddress,
} from '../dist/utils/emailRecipient.js';

test('accepts normal recipient shapes', () => {
  for (const ok of [
    'support@jiopay.in',
    'Prithvish@Chowman.IN',
    'first.last+tag@mail.example.co.uk',
    'Ops Team <ops@juspay.in>',
    '"Last, First" <a.b@jiopay.in>',
    '<x@y.io>',
    'a@xn--80ak6aa92e.xn--p1ai',
  ]) {
    assert.equal(isValidRecipientAddress(ok), true, ok);
  }
});

test('rejects addresses the provider will refuse', () => {
  for (const bad of [
    'support@jiopay', // MERCHANTS1-53154: domain without TLD
    'support@',
    '@jiopay.in',
    'support',
    'sup port@jiopay.in',
    'a..b@jiopay.in',
    '.a@jiopay.in',
    'a@-jiopay.in',
    'a@jiopay..in',
    'a@jiopay.i',
    'a@jiopay.123',
    'Name <support@jiopay>',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isValidRecipientAddress(bad), false, String(bad));
  }
});

test('findInvalidRecipients names only the bad ones, in order, once', () => {
  assert.deepEqual(
    findInvalidRecipients([
      'itsm.helpdesk@jiopay.in',
      'support@jiopay',
      'prithvish@chowman.in',
      'SUPPORT@jiopay',
      'oops',
    ]),
    ['support@jiopay', 'oops'],
  );
  assert.deepEqual(findInvalidRecipients(undefined), []);
});

test('extractRecipientAddress strips display names', () => {
  assert.equal(extractRecipientAddress('Ops <ops@juspay.in>'), 'ops@juspay.in');
  assert.equal(extractRecipientAddress('  ops@juspay.in '), 'ops@juspay.in');
});
