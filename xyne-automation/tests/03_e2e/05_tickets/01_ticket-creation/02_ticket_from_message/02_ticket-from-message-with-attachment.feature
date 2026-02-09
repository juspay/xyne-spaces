@e2e @tickets @ticket-from-message
Feature: Create Ticket from Message with Attachment
  As an admin user
  I want to create a ticket from an existing chat message with file attachments
  So that I can convert discussions with files into actionable tickets

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-from-message-with-attachment
  Scenario: Create a ticket from message with attachment
    When I wait for "[data-testid='message-input']" to appear
    And I type "Mobile app crash when uploading large files - see attachment" on the element "[data-testid='message-input']"
    And I store "Mobile app crash when uploading large files - see attachment" as "lastSentMessage"
    And I wait for "[data-testid='send-message-button']" to appear
    And I click on "[data-testid='send-message-button']"
    And I wait for 2 seconds
    When I hover on the last sent message
    And I click on Create Ticket from message hover actions
    And I type "Mobile App Upload Crash" on the element "[data-testid='ticket-title-input']"
    Then the element "[data-testid='ticket-description-input']" should contain text "Mobile app crash when uploading large files - see attachment"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Critical" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-from-thread-with-attachment
  Scenario: Create a ticket from thread panel with attachment
    When I wait for "[data-testid='message-input']" to appear
    And I type "Server performance degradation during peak hours - logs attached" on the element "[data-testid='message-input']"
    And I store "Server performance degradation during peak hours - logs attached" as "lastSentMessage"
    And I wait for "[data-testid='send-message-button']" to appear
    And I click on "[data-testid='send-message-button']"
    And I wait for 2 seconds
    When I hover on the last sent message
    And I click on Reply in thread from message hover actions
    Then the thread panel should be visible
    When I click on Create Ticket button in thread panel
    And I type "Server Performance Degradation" on the element "[data-testid='ticket-title-input']"
    And I type "Server experiencing performance issues during peak traffic hours" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I select a workflow if available
    And I click on "[data-testid='ticket-submit-button']"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
