import assert from 'node:assert/strict';
import { Step } from 'gauge-ts';
import { getStoredUser } from '@/fixtures/fixture-helpers';
import {
  assertStatus,
  buildDeskMailboxEmail,
  connectMockDeskChannelSource,
  createDeskChannelViaApi,
  disconnectDeskChannelSource,
  fetchDeskChannelConnectionStatus,
  getStoredChannelId,
  postMockSharedMailbox,
  withDevAuthenticatedApiContext,
} from '@/tests/03_e2e/11_xyne-desk/xyne-desk-api';
import { deskChannelDlEmails } from '@/tests/03_e2e/11_xyne-desk/xyne-desk-state';
import {
  assertValidChannelAlias,
  assertValidProjectAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

export default class XyneDeskChannelSteps {
  // ---------------------------------------------------------------------------
  // SETUP
  // ---------------------------------------------------------------------------

  @Step('configuring mock Desk shared mailbox for user <userAlias>')
  public async configureMockSharedMailbox(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    getStoredUser(userAlias);

    const response = await postMockSharedMailbox(userAlias);
    await assertStatus(response, 'Mock Desk shared mailbox setup');
  }

  @Step(
    'creating mock DL Desk channel <channelAlias> for user <userAlias> in project <projectAlias>'
  )
  public async createMockDlDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    await createDeskChannelViaApi('DL', channelAlias, userAlias, projectAlias);
  }

  @Step(
    'Creating personal Desk channel <channelAlias> for user <userAlias> in project <projectAlias>'
  )
  public async createPersonalDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    await createDeskChannelViaApi('personal', channelAlias, userAlias, projectAlias);
  }

  @Step('Creating Slack Desk channel <channelAlias> for user <userAlias> in project <projectAlias>')
  public async createSlackDeskChannel(
    channelAlias: string,
    userAlias: string,
    projectAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assertValidProjectAlias(projectAlias);
    await createDeskChannelViaApi('Slack', channelAlias, userAlias, projectAlias);
  }

  @Step('clearing mock Desk sent mails for channel <channelAlias> user <userAlias>')
  public async clearMockDeskSentMails(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.delete(`/api/test/desk/sent-mails?channelId=${encodeURIComponent(channelId)}`)
    );
    await assertStatus(response, 'Mock Desk sent-mail reset');
  }

  @Step('setting Desk auto-merge <enabled> for channel <channelAlias> user <userAlias>')
  public async setDeskAutoMerge(
    enabled: string,
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    assert.ok(enabled === 'on' || enabled === 'off', 'Auto-merge must be "on" or "off".');
    const channelId = getStoredChannelId(channelAlias, userAlias);

    const response = await withDevAuthenticatedApiContext(userAlias, (apiContext) =>
      apiContext.patch(`/api/test/desk/channel/${channelId}/auto-merge`, {
        data: { enabled: enabled === 'on' },
      })
    );
    await assertStatus(response, 'Desk auto-merge preference update');
  }

  // ---------------------------------------------------------------------------
  // ACTION
  // ---------------------------------------------------------------------------

  @Step('disconnecting Desk mailbox for channel <channelAlias> user <userAlias>')
  public async disconnectDeskMailbox(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await disconnectDeskChannelSource(channelAlias, userAlias, 'Desk mailbox disconnect');
  }

  @Step('reconnecting mock Desk mailbox for channel <channelAlias> user <userAlias>')
  public async reconnectMockDeskMailbox(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const channelId = getStoredChannelId(channelAlias, userAlias);
    const channel = getStoredUser(userAlias).channels[channelAlias];
    const email =
      deskChannelDlEmails.get(channelAlias) || buildDeskMailboxEmail(channel.name ?? channelAlias);

    await connectMockDeskChannelSource(userAlias, channelId, email, 'Mock Desk mailbox reconnect');
    deskChannelDlEmails.set(channelAlias, email);
  }

  @Step('disconnecting Slack Desk channel <channelAlias> for user <userAlias>')
  public async disconnectSlackDeskChannel(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    await disconnectDeskChannelSource(channelAlias, userAlias, 'Slack Desk disconnect');
  }

  // ---------------------------------------------------------------------------
  // ASSERTION
  // ---------------------------------------------------------------------------

  @Step('verifying user <userAlias> cannot configure mock Desk shared mailbox')
  public async verifyUserCannotConfigureMockSharedMailbox(userAlias: string): Promise<void> {
    assertValidUserAlias(userAlias);
    getStoredUser(userAlias);

    const response = await postMockSharedMailbox(userAlias);
    const responseBody = await response.text();

    assert.equal(
      response.status(),
      403,
      `Expected user "${userAlias}" to be blocked from mock Desk shared mailbox setup. Body: ${responseBody}`
    );
  }

  @Step('verifying Desk channel <channelAlias> is connected for user <userAlias>')
  public async verifyDeskChannelConnected(channelAlias: string, userAlias: string): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const status = await fetchDeskChannelConnectionStatus(channelAlias, userAlias);

    assert.equal(
      status.hasSource,
      true,
      `Expected Desk channel "${channelAlias}" to have a source.`
    );
    assert.equal(
      status.isConnected,
      true,
      `Expected Desk channel "${channelAlias}" to be connected.`
    );
  }

  @Step('verifying Desk channel <channelAlias> is disconnected for user <userAlias>')
  public async verifyDeskChannelDisconnected(
    channelAlias: string,
    userAlias: string
  ): Promise<void> {
    assertValidChannelAlias(channelAlias);
    assertValidUserAlias(userAlias);
    const status = await fetchDeskChannelConnectionStatus(channelAlias, userAlias);

    assert.equal(status.hasSource, true, `Expected Desk channel "${channelAlias}" to keep source.`);
    assert.equal(
      status.isConnected,
      false,
      `Expected Desk channel "${channelAlias}" to be disconnected.`
    );
  }
}
