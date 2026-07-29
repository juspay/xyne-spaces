import { Step } from 'gauge-ts';
import { buildRandomSuffix, getStoredUser } from '@/fixtures/fixture-helpers';
import { type StoredTicket, testContext } from '@/tests/shared/runtime/test-context';
import {
  assertValidTicketAlias,
  assertValidUserAlias,
} from '@/tests/shared/support/literal-validation';

export default class TicketsSteps {
  // ===========================================
  // FIXTURE GENERATION
  // ===========================================

  @Step('generating net-new ticket details <ticketAlias> for user <userAlias>')
  public async generateNetNewTicketDetails(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);

    if (user.tickets[ticketAlias]) {
      return;
    }

    const suffix = buildRandomSuffix();
    const ticketTitle = `Ticket ${suffix}`;
    const ticketDescription = `Auto-generated ticket description for ${ticketAlias}`;

    const ticket: StoredTicket = {
      alias: ticketAlias,
      title: ticketTitle,
      description: ticketDescription,
      priority: 'Medium',
      status: 'Todo',
    };

    user.tickets[ticketAlias] = ticket;
  }

  @Step('ensuring ticket <ticketAlias> exists in fixture for user <userAlias>')
  public async ensureTicketExistsInFixture(ticketAlias: string, userAlias: string): Promise<void> {
    assertValidTicketAlias(ticketAlias);
    assertValidUserAlias(userAlias);

    const user = getStoredUser(userAlias);

    if (user.tickets[ticketAlias]) {
      return;
    }

    await this.generateNetNewTicketDetails(ticketAlias, userAlias);
  }

  // ===========================================
  // TICKET ACTIONS
  // ===========================================

  @Step('clicking on "[data-testid=\'send-options-menu\']"')
  public async clickSendOptionsMenu(): Promise<void> {
    await testContext.activePage.locator("[data-testid='send-options-menu']").first().click();
  }

  @Step('clicking on "[data-testid=\'ticket-assignee-selector\']"')
  public async clickTicketAssigneeSelector(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='ticket-assignee-selector']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'ticket-priority-selector\']"')
  public async clickTicketPrioritySelector(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='ticket-priority-selector']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'ticket-status-selector\']"')
  public async clickTicketStatusSelector(): Promise<void> {
    await testContext.activePage.locator("[data-testid='ticket-status-selector']").first().click();
  }

  @Step('clicking on "[data-testid=\'ticket-due-date-selector\']"')
  public async clickTicketDueDateSelector(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='ticket-due-date-selector']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'ticket-submit-button\']"')
  public async clickTicketSubmitButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='ticket-submit-button']").first().click();
  }

  @Step('clicking on "[data-testid=\'create-sub-ticket-button\']"')
  public async clickCreateSubTicketButton(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='create-sub-ticket-button']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'ticket-detail-status-selector\']"')
  public async clickTicketDetailStatusSelector(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='ticket-detail-status-selector']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'ticket-detail-priority-selector\']"')
  public async clickTicketDetailPrioritySelector(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='ticket-detail-priority-selector']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'channel-tab-tickets\']"')
  public async clickChannelTabTickets(): Promise<void> {
    await testContext.activePage.locator("[data-testid='channel-tab-tickets']").first().click();
  }

  @Step('clicking on "[data-testid=\'kanban-create-ticket-button\']"')
  public async clickKanbanCreateTicketButton(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='kanban-create-ticket-button']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'my-tickets-btn\']"')
  public async clickMyTicketsBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='my-tickets-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'more-filters-btn\']"')
  public async clickMoreFiltersBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='more-filters-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'filter-menu-priority\']"')
  public async clickFilterMenuPriority(): Promise<void> {
    await testContext.activePage.locator("[data-testid='filter-menu-priority']").first().click();
  }

  @Step('clicking on "[data-testid=\'priority-filter-low\']"')
  public async clickPriorityFilterLow(): Promise<void> {
    await testContext.activePage.locator("[data-testid='priority-filter-low']").first().click();
  }

  @Step('clicking on "[data-testid=\'priority-filter-medium\']"')
  public async clickPriorityFilterMedium(): Promise<void> {
    await testContext.activePage.locator("[data-testid='priority-filter-medium']").first().click();
  }

  @Step('clicking on "[data-testid=\'priority-filter-high\']"')
  public async clickPriorityFilterHigh(): Promise<void> {
    await testContext.activePage.locator("[data-testid='priority-filter-high']").first().click();
  }

  @Step('clicking on "[data-testid=\'priority-filter-critical\']"')
  public async clickPriorityFilterCritical(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='priority-filter-critical']")
      .first()
      .click();
  }

  @Step('clicking on "[data-testid=\'clear-filters-btn\']"')
  public async clickClearFiltersBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='clear-filters-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'table-view-btn\']"')
  public async clickTableViewBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='table-view-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'calendar-view-btn\']"')
  public async clickCalendarViewBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='calendar-view-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'kanban-view-btn\']"')
  public async clickKanbanViewBtn(): Promise<void> {
    await testContext.activePage.locator("[data-testid='kanban-view-btn']").first().click();
  }

  @Step('clicking on "[data-testid=\'group-by-dropdown\']"')
  public async clickGroupByDropdown(): Promise<void> {
    await testContext.activePage.locator("[data-testid='group-by-dropdown']").first().click();
  }

  @Step('clicking on "[data-testid=\'group-by-assignee\']"')
  public async clickGroupByAssignee(): Promise<void> {
    await testContext.activePage.locator("[data-testid='group-by-assignee']").first().click();
  }

  @Step('clicking on "[data-testid=\'group-by-status\']"')
  public async clickGroupByStatus(): Promise<void> {
    await testContext.activePage.locator("[data-testid='group-by-status']").first().click();
  }

  @Step('clicking on "[data-testid=\'group-by-priority\']"')
  public async clickGroupByPriority(): Promise<void> {
    await testContext.activePage.locator("[data-testid='group-by-priority']").first().click();
  }
}
