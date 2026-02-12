@e2e @tickets @ticket-from-message
Feature: Ticket Edit and Sub-Ticket Creation from Message E2E Flow
  As an admin user
  I want to edit tickets and create sub-tickets within tickets created from messages
  So that I can update ticket info and break down discussions into smaller pieces

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-edit @sub-ticket @from-message @multiple-sub-tickets
  Scenario: Admin edits ticket and creates multiple sub-tickets from message ticket
    # Use the ticket created in 01_ticket-from-message.feature
    When I click on ticket card with title "Ticket from Message"
    And I click on "[data-testid='ticket-detail-status-selector']"
    And I click on "ul[role='listbox'] li button:has-text('In Progress')"
    And I click on "[data-testid='ticket-detail-eta-display']"
    And I set datetime input "[data-testid='ticket-detail-eta-input'] input" to 7 days from now
    And I click on "[data-testid='ticket-detail-priority-selector']"
    And I click on "ul[role='listbox'] li button:has-text('Critical')"
   
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Export existing data from MySQL" on the element "[data-testid='ticket-title-input']"
    And I type "Create backup and export all data from MySQL database" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear
    # Create second sub-ticket - with assignee and attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Design new onboarding screens" on the element "[data-testid='ticket-title-input']"
    And I type "Create wireframes and mockups for the redesigned onboarding flow" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear


