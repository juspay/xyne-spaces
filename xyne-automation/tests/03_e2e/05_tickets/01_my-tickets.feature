@e2e @my-tickets
Feature: My Tickets - Filter and View Options

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/chat/dir"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  Scenario: User can apply and clear filters, switch views, and change group-by options
  
    And I click on "[data-testid='my-tickets-btn']"
    And I should see the element "[data-testid='more-filters-btn']"
    And I click on "[data-testid='more-filters-btn']"
    And I click on "[data-testid='filter-menu-priority']"
    And I click on "[data-testid='priority-filter-low']"
    And I click on "[data-testid='priority-filter-medium']"
    And I click on "[data-testid='priority-filter-high']"
    And I click on "[data-testid='priority-filter-critical']"
    And I click on "[data-testid='clear-filters-btn']"
    And I click on "[data-testid='table-view-btn']"
    And I click on "[data-testid='calendar-view-btn']"
    And I click on "[data-testid='kanban-view-btn']"
    And I click on "[data-testid='group-by-dropdown']"
    And I click on "[data-testid='group-by-assignee']"
    And I click on "[data-testid='group-by-dropdown']"
    And I click on "[data-testid='group-by-status']"
    And I click on "[data-testid='group-by-dropdown']"
    And I click on "[data-testid='group-by-priority']"
