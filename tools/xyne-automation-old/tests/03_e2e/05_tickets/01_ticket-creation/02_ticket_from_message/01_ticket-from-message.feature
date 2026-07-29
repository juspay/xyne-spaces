@e2e @tickets @ticket-from-message
Feature: Create Ticket from Message Hover Actions
  As an admin user
  I want to create a ticket from an existing chat message
  So that I can convert discussions into actionable tickets

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-from-message-basic
  Scenario: Create a ticket from a sent message using hover actions
    When I wait for "[data-testid='message-input']" to appear
    And I type "We need to fix the login page timeout issue" on the element "[data-testid='message-input']"
    And I store "We need to fix the login page timeout issue" as "lastSentMessage"
    And I wait for "[data-testid='send-message-button']" to appear
    And I click on "[data-testid='send-message-button']"
    And I wait for 2 seconds
    When I hover on the last sent message
    And I click on "[data-testid='hover-action-create-ticket']"
    And I wait for "[data-testid='ticket-title-input']" to appear
    And I type "Ticket from Message" on the element "[data-testid='ticket-title-input']"
    Then the element "[data-testid='ticket-description-input']" should contain text "We need to fix the login page timeout issue"
    And I click on "[data-testid='ticket-board-selector']"
    And I click on the first button in the element "[data-testid='ticket-board-selector-options']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear

  @ticket-from-thread
  Scenario: Create a ticket from thread panel and assign to another user
    When I wait for "[data-testid='message-input']" to appear
    And I type "API response time is slow - need to optimize" on the element "[data-testid='message-input']"
    And I store "API response time is slow - need to optimize" as "lastSentMessage"
    And I wait for "[data-testid='send-message-button']" to appear
    And I click on "[data-testid='send-message-button']"
    And I wait for 2 seconds
    When I hover on the last sent message
    And I click on "[data-testid='hover-action-reply-in-thread']"
    And I wait for "[data-testid='thread-create-ticket-button']" to appear
    When I click on "[data-testid='thread-create-ticket-button']"
    And I wait for "[data-testid='ticket-title-input']" to appear
    And I type "Ticket from Thread" on the element "[data-testid='ticket-title-input']"
    And I type "API response times are exceeding SLA thresholds" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-board-selector']"
    And I click on the first button in the element "[data-testid='ticket-board-selector-options']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click on "[data-testid='ticket-submit-button']"
    And I wait for "[data-testid='ticket-title-input']" to disappear
