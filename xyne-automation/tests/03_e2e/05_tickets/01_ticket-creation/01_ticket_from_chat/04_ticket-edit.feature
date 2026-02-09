@e2e @tickets @ticket-edit
Feature: Ticket Edit E2E Flow from Chat
  As an admin user
  I want to edit ticket properties like status, ETA, and priority for existing tickets
  So that I can update ticket information as the work progresses

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-edit @edit-properties
  Scenario: Admin edits properties of an existing ticket created from chat
    # Use ticket created in 01_ticket-creation.feature
    When I click on ticket card with title "Bug: Application crashes on submit"
    # Change ticket status to "In Progress"
    And I click on "[data-testid='ticket-detail-status-selector']"
    And I click on "ul[role='listbox'] li button:has-text('In Progress')"
    # Set ticket ETA to 7 days from now
    And I click on "[data-testid='ticket-detail-eta-display']"
    And I set datetime input "[data-testid='ticket-detail-eta-input'] input" to 7 days from now
    # Change ticket priority to "Critical"
    And I click on "[data-testid='ticket-detail-priority-selector']"
    And I click on "ul[role='listbox'] li button:has-text('Critical')"
