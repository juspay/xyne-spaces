@e2e @tickets
Feature: Ticket Creation E2E Flow
  As an admin user
  I want to create tickets from the chat interface
  So that I can track issues and tasks

  Scenario: Admin creates a Bug ticket from chat
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I type "This is a bug report: Application crashes when clicking submit button" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    Then the element "[data-testid='ticket-description-input']" should contain text "This is a bug report: Application crashes when clicking submit button"
    And I type "Bug: Application crashes on submit" on the element "[data-testid='ticket-title-input']"
    And I type "Steps to reproduce: 1. Click submit button 2. App crashes" on the element "[data-testid='ticket-description-input']"
    # Select Assignee - assign to user2
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"
    


  @ticket-create @ticket-create-feature
  Scenario: Admin creates a Feature Request ticket
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    # Open create ticket flow
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    And I type "Feature: Add dark mode support" on the element "[data-testid='ticket-title-input']"
    And I type "Users have requested dark mode for better night-time usage" on the element "[data-testid='ticket-description-input']"
    # Assign to user2
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"


  @ticket-create @ticket-create-test
  Scenario: Admin creates a Test ticket
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    And I type "Test: Verify login flow works correctly" on the element "[data-testid='ticket-title-input']"
    And I type "Need to test the complete login flow including SSO" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Low" in the element "[data-testid='ticket-priority-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"

  @ticket-create @ticket-create-user
  Scenario: Admin creates a User Story ticket
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    # Open create ticket flow
    And I click on "[data-testid='send-options-menu']"
    And I click on text "Create a ticket"
    And I click on "[data-testid='send-message-button']"
    And I type "User Story: As a user I want to export reports" on the element "[data-testid='ticket-title-input']"
    And I type "As a user, I want to export reports to PDF so that I can share them offline" on the element "[data-testid='ticket-description-input']"
    # Assign to user2
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I select a workflow if available
    And I click the button with text "Create Ticket"
    
 
