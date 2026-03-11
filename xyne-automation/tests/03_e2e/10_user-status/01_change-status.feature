@e2e @user-status
Feature: User Status and Theme Settings

  Background:
    Given using browser "admin-browser"

  Scenario: User sets their status and changes theme
    When I open the Xyne-Space at "/chat/dit"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on the 1th occurrence of text "T"
    And I click on "[data-testid='set-status-btn']"
    And I click the button with text "In a meeting"
    And I click on "[data-testid='update-status-save-btn']"
