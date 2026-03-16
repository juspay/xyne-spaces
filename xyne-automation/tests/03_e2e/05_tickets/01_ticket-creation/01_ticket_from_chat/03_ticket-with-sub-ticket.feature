@e2e @tickets @sub-ticket
Feature: Ticket Edit and Sub-Ticket Creation E2E Flow from Chat
  As an admin user
  I want to edit tickets and create sub-tickets within existing tickets
  So that I can update ticket info and break down complex tasks into smaller pieces

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-edit @sub-ticket @multiple-sub-tickets
  Scenario: Admin edits ticket and creates multiple sub-tickets
    # Use the ticket created in 01_ticket-creation.feature
    When I click on ticket card with title "Ticket from Chat"
    And I click on "[data-testid='ticket-detail-status-selector']"
    And I click on "ul[role='listbox'] li button:has-text('In Progress')"
    And I click on "[data-testid='ticket-detail-priority-selector']"
    And I click on "ul[role='listbox'] li button:has-text('Critical')"
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Design OAuth2 flow diagram" on the element "[data-testid='ticket-title-input']"
    And I type "Create a detailed diagram showing the OAuth2 authentication flow" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear
    # Create second sub-ticket - with assignee and attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Implement database schema" on the element "[data-testid='ticket-title-input']"
    And I type "Design and implement the PostgreSQL database schema" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear


