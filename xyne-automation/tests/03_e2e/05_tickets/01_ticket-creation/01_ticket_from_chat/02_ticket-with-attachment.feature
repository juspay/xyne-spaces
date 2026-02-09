@e2e @tickets
Feature: Ticket Creation with Attachments E2E Flow
  As an admin user
  I want to create tickets with file attachments
  So that I can provide additional context with files

  Background:
    Given using browser "admin-browser"
    And the backend API is accessible

  @ticket-create @ticket-attachment
  Scenario: Admin creates a ticket with attachment
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    And I type "Bug with screenshot attached" on the element "[data-testid='ticket-title-input']"
    And I type "Please see the attached screenshot for the error" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    # Assign to user2
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

