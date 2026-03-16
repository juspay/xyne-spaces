@e2e @tickets @ticket-from-tickets-tab
Feature: Ticket Edit and Sub-Ticket Creation from Tickets Tab E2E Flow
  As an admin user
  I want to edit tickets and create sub-tickets within tickets created from Tickets tab
  So that I can update ticket info and manage complex tasks from the Kanban board

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-edit @sub-ticket @from-tickets-tab @multiple-sub-tickets
  Scenario: Admin edits ticket and creates multiple sub-tickets from Tickets tab ticket
    # Use the ticket created in 01_ticket-from-tickets-tab.feature
    When I click on ticket card with title "Ticket from Tickets Tab"
    And I click on "[data-testid='ticket-detail-status-selector']"
    And I click on "ul[role='listbox'] li button:has-text('In Progress')"
    And I click on "[data-testid='ticket-detail-priority-selector']"
    And I click on "ul[role='listbox'] li button:has-text('Critical')"
    # Create first sub-ticket - basic
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Research payment gateway options" on the element "[data-testid='ticket-title-input']"
    And I type "Compare Stripe, PayPal, and Razorpay APIs for pricing and features" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear
    # Create second sub-ticket - with assignee and attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Set up auto-scaling policies" on the element "[data-testid='ticket-title-input']"
    And I type "Configure auto-scaling based on traffic patterns" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='ticket-title-input']" to disappear


