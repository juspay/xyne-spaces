@e2e @user-status
Feature: User Status and Theme Settings

  Background:
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat/dir"
    And I wait for "[data-testid='chat-list-loading']" to disappear

  Scenario: User sets their status and changes theme
    
    And I click on "[data-testid='profile-icon']"
    And I should see the element "[data-testid='set-status-btn']"
    And I click on "[data-testid='set-status-btn']"
    And I should see the element "[data-testid='status-suggestion']"
    And I click on text "In a meeting" in the element "[data-testid='status-suggestion']"
    And I click on "[data-testid='update-status-save-btn']"
