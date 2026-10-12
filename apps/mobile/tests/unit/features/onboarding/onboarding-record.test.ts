/**
 * What gets stored for each way out of the deck. The shape is the dashboard's, so these pin the
 * parts the backend and analysis depend on: the question strings, which outcomes carry company
 * answers, and that an empty questionnaire is still produced.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPendingOnboarding } from '@/src/features/onboarding/model/onboarding-record';

describe('onboarding record', () => {
  it('records company name and size for an org the person created', () => {
    const record = buildPendingOnboarding(
      'Devesh@Acme.com ',
      { role: ' Product Manager ', companySize: '11-100' },
      { kind: 'create-org', orgName: 'Acme Inc', workspaceName: 'Acme' },
    );

    assert.deepEqual(record, {
      email: 'devesh@acme.com',
      role: 'Product Manager',
      questionnaire: {
        company_name: { question: 'Company name', answer: 'Acme Inc' },
        company_size: { question: 'Company size', answer: '11-100' },
      },
    });
  });

  it('keeps company answers out of anything but a created org', () => {
    // A stale size left in the answers (picked, then went back and chose the community).
    const answers = { role: 'Designer', companySize: '1000+' } as const;

    for (const outcome of [
      { kind: 'join-community' },
      { kind: 'create-enterprise-workspace', workspaceName: 'Acme Labs' },
      { kind: 'nothing' },
    ] as const) {
      assert.deepEqual(buildPendingOnboarding('a@b.com', answers, outcome).questionnaire, {});
    }
  });

  it('still produces an empty questionnaire when nothing was answered', () => {
    // Its existence is what marks the email as onboarded on the backend.
    assert.deepEqual(buildPendingOnboarding('a@b.com', {}, { kind: 'join-community' }), {
      email: 'a@b.com',
      questionnaire: {},
    });
  });

  it('carries a typed name and drops a blank one', () => {
    const outcome = { kind: 'join-community' } as const;
    assert.equal(
      buildPendingOnboarding('a@b.com', { name: ' Devesh ' }, outcome).displayName,
      'Devesh',
    );
    assert.equal(
      'displayName' in buildPendingOnboarding('a@b.com', { name: '   ' }, outcome),
      false,
    );
  });
});
