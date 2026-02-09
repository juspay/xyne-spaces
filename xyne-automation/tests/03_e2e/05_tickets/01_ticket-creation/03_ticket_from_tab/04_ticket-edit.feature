@e2e @tickets @ticket-edit @from-tickets-tab
Feature: Ticket Edit E2E Flow from Tickets Tab
  As an admin user
  I want to edit ticket properties like status, ETA, and priority for existing tickets created from Tickets tab
  So that I can update ticket information as the work progresses

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-edit @edit-properties @from-tickets-tab
  Scenario: Admin edits properties of an existing ticket created from Tickets tab
    When I click on the channel Tickets tab
    
    And I click on "[data-testid^='ticket-card']:first-child"
  
    And I click on "[data-testid='ticket-detail-status-selector']"
    And I click on "ul[role='listbox'] li button:has-text('In Progress')"

    And I click on "[data-testid='ticket-detail-eta-display']"
    And I set datetime input "[data-testid='ticket-detail-eta-input'] input" to 10 days from now

    And I click on "[data-testid='ticket-detail-priority-selector']"
    And I click on "ul[role='listbox'] li button:has-text('Critical')"
  