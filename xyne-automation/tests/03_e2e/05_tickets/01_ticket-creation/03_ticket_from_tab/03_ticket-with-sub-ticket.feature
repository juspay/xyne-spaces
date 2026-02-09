@e2e @tickets @ticket-from-tickets-tab
Feature: Ticket with Sub-Ticket Creation from Tickets Tab E2E Flow
  As an admin user
  I want to create sub-tickets within tickets that were created from the Tickets tab
  So that I can manage complex tasks directly from the Kanban board view

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  @ticket-create @sub-ticket @from-tickets-tab
  Scenario: Admin adds a sub-ticket to existing ticket from Tickets tab
    # Use the ticket created in 01_ticket-from-tickets-tab.feature ("Ticket from Tickets Tab")
    When I click on ticket card with title "Ticket from Tickets Tab"
    # Create sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Research payment gateway options" on the element "[data-testid='ticket-title-input']"
    And I type "Compare Stripe, PayPal, and Razorpay APIs for pricing and features" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click on "[data-testid='ticket-status-selector']"
    And I click on text "Todo" in the element "[data-testid='ticket-status-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-tickets-tab @multiple-sub-tickets
  Scenario: Admin adds multiple sub-tickets to existing ticket from Tickets tab
    # Use the ticket created in 01_ticket-from-tickets-tab.feature ("Feature Request from Tickets Tab")
    When I click on ticket card with title "Feature Request from Tickets Tab"
    # Create first sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Run automated security scans" on the element "[data-testid='ticket-title-input']"
    And I type "Execute OWASP ZAP and SonarQube scans" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Critical" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
    # Create second sub-ticket
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Fix identified vulnerabilities" on the element "[data-testid='ticket-title-input']"
    And I type "Address all high and medium severity findings" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "High" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-tickets-tab @sub-ticket-with-attachment
  Scenario: Admin adds a sub-ticket with attachment to existing ticket from Tickets tab
    # Use the ticket created in 01_ticket-from-tickets-tab.feature ("Ticket from Tickets Tab")
    When I click on ticket card with title "Ticket from Tickets Tab"
    # Create sub-ticket with attachment
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Process negative feedback reviews" on the element "[data-testid='ticket-title-input']"
    And I type "Identify common themes in negative reviews and create action items" on the element "[data-testid='ticket-description-input']"
    And I attach a test file to the ticket
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear

  @ticket-create @sub-ticket @from-tickets-tab @with-assignee
  Scenario: Admin adds a sub-ticket and assigns to user on existing ticket from Tickets tab
    # Use the ticket created in 01_ticket-from-tickets-tab.feature ("Feature Request from Tickets Tab")
    When I click on ticket card with title "Feature Request from Tickets Tab"
    # Create sub-ticket and assign to user2
    And I click on "[data-testid='create-sub-ticket-button']"
    And I type "Set up auto-scaling policies" on the element "[data-testid='ticket-title-input']"
    And I type "Configure auto-scaling based on traffic patterns" on the element "[data-testid='ticket-description-input']"
    And I click on "[data-testid='ticket-assignee-selector']"
    And I type "user:user2-browser.name" on the element "[data-testid='ticket-assignee-selector-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='ticket-assignee-selector-options']"
    And I click on "[data-testid='ticket-priority-selector']"
    And I click on text "Medium" in the element "[data-testid='ticket-priority-selector-options']"
    And I click the button with text "Create Ticket"
    And I wait for "[data-testid='create-ticket-modal']" to disappear
