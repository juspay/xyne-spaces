@e2e @user-groups @user-group-creation
Feature: User Group Creation

  # The /user-groups route is permission-gated. A direct URL navigation races
  # the permissions fetch and gets redirected to home. Enter via the in-app
  # sidebar nav — the testid only renders once the state machine has hydrated
  # the user's permissions.

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/chat/dir"
    And I should see the element "[data-testid='nav-user-groups']"
    And I click on "[data-testid='nav-user-groups']"

  Scenario: Create a user group with multiple members
    And I should see the element "[data-testid='create-user-group-btn']"
    And I click on "[data-testid='create-user-group-btn']"
    And I click on "[data-testid='user-group-name-input']"
    And I type "user:user2-browser.name" on the element "[data-testid='user-group-name-input']"
    And I click on "[data-testid='members-tab-btn']"
    And I click on "[data-testid='search-members-input']"
    And I type "test user 1" on the element "[data-testid='search-members-input']"
    And I click the button with text "Add to Group"
    And I type "test user 2" on the element "[data-testid='search-members-input']"
    And I click the button with text "Add to Group"
    And I click on "[data-testid='search-members-input']"
    And I type "test user 3" on the element "[data-testid='search-members-input']"
    And I click the button with text "Add to Group"
    And I click on "[data-testid='submit-user-group-btn']"
    Then I should see the element "[data-testid='user-group-list-item']"
    When I click the button with text "Deactivate"
    Then I should see "Deactivated" in the element "[data-testid='user-group-list-item']"
    And I should see a button with text "Reactivate"