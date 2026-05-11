import { Step } from 'gauge-ts';
import { testContext } from '@/tests/shared/runtime/test-context';

export default class CallsSteps {
  @Step('clicking on "[data-testid=\'call-history-item\']"')
  public async clickCallHistoryItem(): Promise<void> {
    await testContext.activePage.locator("[data-testid='call-history-item']").first().click();
  }

  @Step('clicking on "[data-testid=\'call-join-button\']"')
  public async clickCallJoinButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='call-join-button']").first().click();
  }

  @Step('typing <text> in "[data-testid=\'call-search-input\']"')
  public async typeInCallSearchInput(text: string): Promise<void> {
    const input = testContext.activePage.locator("[data-testid='call-search-input']").first();
    await input.waitFor({ state: 'visible' });
    await input.fill(text);
  }

  @Step('clicking on "[data-testid=\'participants-button\']"')
  public async clickParticipantsButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='participants-button']").first().click();
  }

  @Step('clicking on "[data-testid=\'mute-user-button\']:first-child"')
  public async clickMuteUserButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='mute-user-button']").first().click();
  }

  @Step('verifying "[data-testid=\'participants-panel\']" is visible')
  public async verifyParticipantsPanelVisible(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='participants-panel']")
      .first()
      .waitFor({ state: 'visible' });
  }

  @Step('verifying "Muted" is visible in "[data-testid=\'participants-list\']"')
  public async verifyMutedInParticipantsList(): Promise<void> {
    const list = testContext.activePage.locator("[data-testid='participants-list']").first();
    await list.waitFor({ state: 'visible' });
    await list.getByText('Muted', { exact: false }).first().waitFor({ state: 'visible' });
  }

  @Step('verifying "[data-testid=\'participant-count\']" is visible')
  public async verifyParticipantCountVisible(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='participant-count']")
      .first()
      .waitFor({ state: 'visible' });
  }

  @Step('verifying "A call is going on" is visible in "[data-testid=\'virtuoso-item-list\']"')
  public async verifyCallGoingOnInChat(): Promise<void> {
    const list = testContext.activePage.locator("[data-testid='virtuoso-item-list']").first();
    await list.waitFor({ state: 'visible' });
    await list
      .getByText('A call is going on', { exact: false })
      .first()
      .waitFor({ state: 'visible' });
  }

  @Step('verifying "Incoming call" is visible in "[data-testid=\'virtuoso-item-list\']"')
  public async verifyIncomingCallInChat(): Promise<void> {
    const list = testContext.activePage.locator("[data-testid='virtuoso-item-list']").first();
    await list.waitFor({ state: 'visible' });
    await list.getByText('Incoming call', { exact: false }).first().waitFor({ state: 'visible' });
  }
}
