@e2e @tickets @sub-ticket
Feature: Ticket with Sub-Ticket Creation E2E Flow from Chat
  As an admin user
  I want to create sub-tickets within existing tickets
  So that I can break down complex tasks into smaller manageable pieces

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-create @sub-ticket
  Scenario: Admin adds a sub-ticket to existing ticket created from chat
    # Use the ticket created in 01_ticket-creation.feature
    When I click on ticket card with title "Bug: Application crashes on submit"
    # Create sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Design OAuth2 flow diagram" on the element "[data-testid='ticket-title-input']"
    And I type "Create a detailed diagram showing the OAuth2 authentication flow" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @multiple-sub-tickets
  Scenario: Admin adds multiple sub-tickets to existing ticket from chat
    # Use the ticket created in 01_ticket-creation.feature
    When I click on ticket card with title "Feature: Add dark mode support"
    # Create first sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Setup database schema" on the element "[data-testid='ticket-title-input']"
    And I type "Design and implement the PostgreSQL database schema" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Critical" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
    # Create second sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Implement analytics charts" on the element "[data-testid='ticket-title-input']"
    And I type "Build interactive charts for sales and revenue analytics" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @with-assignee
  Scenario: Admin creates a sub-ticket and assigns to a different user
    # Use the ticket created in 01_ticket-creation.feature
    When I click on ticket card with title "Test: Verify login flow works correctly"
    # Create sub-ticket and assign to user2
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Optimize image loading" on the element "[data-testid='ticket-title-input']"
    And I type "Implement lazy loading and caching for images in the mobile app" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @sub-ticket-with-attachment
  Scenario: Admin creates a sub-ticket with attachment
    # Use the ticket created in 01_ticket-creation.feature (User Story ticket)
    When I click on ticket card with title "Bug: Application crashes on submit"
    # Create sub-ticket with attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Debug transaction failure logs" on the element "[data-testid='ticket-title-input']"
    And I type "Analyze the payment transaction logs to identify the root cause of failures" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
