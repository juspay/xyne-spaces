@e2e @project @project-member
Feature: Project Member Management E2E Flow
  As an admin user
  I want to add members to a project via channels
  So that team members can access the project and collaborate

  @project-create-channel
  Scenario: Admin creates a project channel
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/chat"
    And I click on "[data-testid='create-new-channel']"
    And I type "user:admin-browser.id" on the element "[data-testid='channel-name-input']"
    And I click on "[data-testid='create-channel-button']"
    Then the user should be redirected to "/chat/"
    And I should see "user:admin-browser.id" in the element "[data-testid='channel-list']"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I store the current path as "admin-channel-1"

  @project-add-member
  Scenario: Admin grants project access by adding User1 to the channel
    Given using browser "admin-browser"
    When I open the Xyne-Space at "admin-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='channel-info-trigger']"
    And I click on "[data-testid='add-people-button']"
    And I type "user:user1-browser.email" on the element "[data-testid='user-search-input']"
    And I click on text "user:user1-browser.name" in the element "[data-testid='user-search-results']"
    And I click on "[data-testid='add-people-submit']"

  @project-member-verify
  Scenario: User1 sees the channel in their list after being added
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat"
    Then I should see "user:admin-browser.id" in the element "[data-testid='channel-list']"
