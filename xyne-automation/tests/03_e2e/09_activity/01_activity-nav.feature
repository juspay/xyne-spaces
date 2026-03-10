@e2e @activity
Feature: Activity Navigation

  Background:
    Given using browser "admin-browser"

  Scenario: Navigate activity page and interact with tabs and options
    When I open the Xyne-Space at "/chat/dir"
    And I click on "[data-testid='nav-activity']"
    Then I should see the element "[data-testid='activity-heading']"
    And I should see the element "[data-testid='select-activity-heading']"
    When I click the button with text "Actionable"
    And I click the button with text "FYI"
    And I click the button with text "All"
    And I click on "[data-testid='activity-more-options-btn']"
    And I click on "[data-testid='activity-actionable-toggle']"
    And I click the button with text "All"
    And I click the button with text "Your Mentions"
    And I click the button with text "Replies"
    And I click the button with text "Reactions"
    And I click the button with text "Tickets"
    And I click the button with text "Group Mentions"
    And I click on "[data-testid='activity-more-options-btn']"
    And I click on "[data-testid='activity-view-detailed-btn']"
    And I click on "[data-testid='activity-more-options-btn']"
    And I click on "[data-testid='activity-actionable-toggle']"
    And I click the button with text "All"
    And I click the button with text "Actionable"
    And I click the button with text "FYI"
