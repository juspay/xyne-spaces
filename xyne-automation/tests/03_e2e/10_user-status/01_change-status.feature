@e2e @user-status
Feature: User Status and Theme Settings

  Background:
    Given using browser "admin-browser"

  Scenario: User sets their status and changes theme
    When I open the Xyne-Space at "/chat/dir"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='profile-icon']"
    And I click on "[data-testid='set-status-btn']"
    And I click on "[data-testid='status-suggestion-in-a-meeting']"
    And I click on "[data-testid='update-status-save-btn']"
