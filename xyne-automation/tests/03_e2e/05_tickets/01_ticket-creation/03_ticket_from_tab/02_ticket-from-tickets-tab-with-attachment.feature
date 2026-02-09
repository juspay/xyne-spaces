@e2e @tickets @ticket-from-tickets-tab
Feature: Create Ticket from Channel Tickets Tab with Attachment
  As an admin user
  I want to create a ticket from the Tickets tab with file attachments
  So that I can provide additional context with files

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-from-tickets-tab-with-attachment
  Scenario: Create a ticket from Tickets tab with attachment
    When I click on the channel Tickets tab
    When I click on Create Ticket button in Tickets tab
    And I type "Design Mockup Review Required" on the element "[data-testid='ticket-title-input']"
    And I type "Please review the attached design mockups for the new dashboard" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I select a workflow if available
    And I click on "[data-testid='ticket-submit-button']"
    And I wait for "[data-testid='create-ticket-modal']" to disappear