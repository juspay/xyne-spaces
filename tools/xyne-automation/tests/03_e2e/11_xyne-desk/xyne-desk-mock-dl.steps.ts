import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { buildRandomSuffix } from '@/fixtures/fixture-helpers';
import {
  assertStatus,
  buildDeskMailboxEmail,
  fetchMockInbox,
  getMockDlEmail,
  withDevAuthenticatedApiContext,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import {
  DEFAULT_DESK_API_USER_ALIAS,
  mockDlEmails,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';

export default class XyneDeskMockDlSteps {
  // ---------------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------------

  @Step('resetting mock DL provider state')
  public async resetMockDlProviderState(): Promise<void> {
    mockDlEmails.clear();

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.post('/api/test/desk/mock-dl/reset')
    );
    await assertStatus(response, 'Mock DL provider reset');
  }

  @Step('creating mock DL <dlAlias>')
  public async createMockDl(dlAlias: string): Promise<void> {
    const email = buildDeskMailboxEmail(`${dlAlias}.${buildRandomSuffix()}`);
    mockDlEmails.set(dlAlias, email);

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) => apiContext.post('/api/test/desk/mock-dl', { data: { email } })
    );
    await assertStatus(response, `Mock DL "${dlAlias}" creation`);
  }

  // ---------------------------------------------------------------------------
  // ACTION
  // ---------------------------------------------------------------------------

  @Step('adding member <memberEmail> to mock DL <dlAlias>')
  public async addMemberToMockDl(memberEmail: string, dlAlias: string): Promise<void> {
    const dlEmail = getMockDlEmail(dlAlias);
    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.post(`/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/members`, {
          data: { memberEmail },
        })
    );
    await assertStatus(response, `Mock DL "${dlAlias}" member add`);
  }

  @Step('removing member <memberEmail> from mock DL <dlAlias>')
  public async removeMemberFromMockDl(memberEmail: string, dlAlias: string): Promise<void> {
    const dlEmail = getMockDlEmail(dlAlias);
    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.delete(
          `/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/members/${encodeURIComponent(
            memberEmail
          )}`
        )
    );
    await assertStatus(response, `Mock DL "${dlAlias}" member removal`);
  }

  @Step('sending mock provider mail <mailAlias> to mock DL <dlAlias>')
  public async sendMockProviderMailToDl(mailAlias: string, dlAlias: string): Promise<void> {
    const dlEmail = getMockDlEmail(dlAlias);
    const suffix = buildRandomSuffix();

    const response = await withDevAuthenticatedApiContext(
      DEFAULT_DESK_API_USER_ALIAS,
      (apiContext) =>
        apiContext.post(`/api/test/desk/mock-dl/${encodeURIComponent(dlEmail)}/send`, {
          data: {
            from: `sender.${suffix}@example.test`,
            subject: `Mock DL delivery ${mailAlias} ${suffix}`,
            body: `Mock provider DL delivery body for ${mailAlias}.`,
          },
        })
    );
    await assertStatus(response, `Mock provider mail "${mailAlias}" send`);
  }

  // ---------------------------------------------------------------------------
  // ASSERTION
  // ---------------------------------------------------------------------------

  @Step('verifying mock inbox <memberEmail> total mail count is <expectedCount>')
  public async verifyMockInboxTotalCount(
    memberEmail: string,
    expectedCount: string
  ): Promise<void> {
    const inbox = await fetchMockInbox(memberEmail);

    assert.equal(
      inbox.length,
      Number.parseInt(expectedCount, 10),
      `Expected "${memberEmail}" mock inbox to contain ${expectedCount} mail(s).`
    );
  }

  @Step('verifying mock inbox <memberEmail> has <expectedCount> mails from mock DL <dlAlias>')
  public async verifyMockInboxCountFromDl(
    memberEmail: string,
    expectedCount: string,
    dlAlias: string
  ): Promise<void> {
    const dlEmail = getMockDlEmail(dlAlias);
    const inbox = await fetchMockInbox(memberEmail);
    const mailsFromDl = inbox.filter((mail) => mail.dlEmail === dlEmail);

    assert.equal(
      mailsFromDl.length,
      Number.parseInt(expectedCount, 10),
      `Expected "${memberEmail}" mock inbox to contain ${expectedCount} mail(s) from "${dlEmail}".`
    );
  }
}
