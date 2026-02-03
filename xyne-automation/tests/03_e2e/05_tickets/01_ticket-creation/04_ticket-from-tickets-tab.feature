@e2e @tickets @ticket-from-tickets-tab
Feature: Create Ticket from Channel Tickets Tab
  As an admin user
  I want to create a ticket from the Tickets tab in a channel
  So that I can create tickets directly from the channel's ticket view

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-from-tickets-tab-basic
  Scenario: Create a ticket from the channel Tickets tab
    When I click on the channel Tickets tab
    When I click on Create Ticket button in Tickets tab
    And I type "Ticket from Tickets Tab" on the element "[data-testid='ticket-title-input']"
    And I type "This ticket was created from the channel Tickets tab" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I select a workflow if available
    And I click on "[data-testid='ticket-submit-button']"

  @ticket-from-tickets-tab-with-assignee
  Scenario: Create a ticket from Tickets tab and assign to another user
    When I click on the channel Tickets tab
    When I click on Create Ticket button in Tickets tab
    And I type "Feature Request from Tickets Tab" on the element "[data-testid='ticket-title-input']"
    And I type "New feature request created from channel Tickets tab" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I select a workflow if available
    And I click on "[data-testid='ticket-submit-button']"
