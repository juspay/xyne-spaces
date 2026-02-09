@e2e @tickets @ticket-from-message
Feature: Ticket with Sub-Ticket Creation from Message E2E Flow
  As an admin user
  I want to create sub-tickets within tickets that were created from messages
  So that I can break down discussions into smaller actionable pieces

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-create @sub-ticket @from-message
  Scenario: Admin adds a sub-ticket to existing ticket created from message
    # Use the ticket created in 01_ticket-from-message.feature ("Login Page Timeout Issue")
    When I click on ticket card with title "Login Page Timeout Issue"
    # Create sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Export existing data from MySQL" on the element "[data-testid='ticket-title-input']"
    And I type "Create backup and export all data from MySQL database" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Critical" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-message @multiple-sub-tickets
  Scenario: Admin adds multiple sub-tickets to existing ticket from message
    # Use the ticket created in 01_ticket-from-message.feature ("Database Connection Issue")
    When I click on ticket card with title "Database Connection Issue"
    # Create first sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Design new onboarding screens" on the element "[data-testid='ticket-title-input']"
    And I type "Create wireframes and mockups for the redesigned onboarding flow" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
    # Create second sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Implement user tracking for onboarding" on the element "[data-testid='ticket-title-input']"
    And I type "Add analytics to track onboarding completion rates and drop-off points" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-message @sub-ticket-with-attachment
  Scenario: Admin adds a sub-ticket with attachment to existing ticket from message
    # Use the ticket created in 01_ticket-from-message.feature ("API Performance Optimization")
    When I click on ticket card with title "API Performance Optimization"
    # Create sub-ticket with attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Analyze and fix slow SQL queries" on the element "[data-testid='ticket-title-input']"
    And I type "Review and optimize database queries causing performance bottlenecks" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-message @with-assignee
  Scenario: Admin adds a sub-ticket and assigns to user on existing ticket from message
    # Use the ticket created in 01_ticket-from-message.feature ("Login Page Timeout Issue")
    When I click on ticket card with title "Login Page Timeout Issue"
    # Create sub-ticket and assign to user2
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Add screen reader labels to all buttons" on the element "[data-testid='ticket-title-input']"
    And I type "Implement accessibility labels for iOS and Android screens" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
