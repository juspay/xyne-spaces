@e2e @tickets
Feature: Ticket Creation E2E Flow
  As an admin user
  I want to create tickets from the chat interface
  So that I can track issues and tasks

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-create @ticket-from-chat
  Scenario: Admin creates a ticket from chat
    When I type "This is a bug report: Application crashes when clicking submit button" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    Then the element "[data-testid='ticket-description-input']" should contain text "This is a bug report: Application crashes when clicking submit button"
    And I type "Ticket from Chat" on the element "[data-testid='ticket-title-input']"
    And I type "Steps to reproduce: 1. Click submit button 2. App crashes" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-board-selector']"
    And I click on the first button in the element "[data-testid='ticket-board-selector-options']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click on "[data-testid='ticket-due-date-selector']"
    And I select a date 0 days from now in the element "[data-testid='ticket-due-date-calendar']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear
