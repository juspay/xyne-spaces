@e2e @messaging @channel @canvas
Feature: Channel Creation E2E Flow
  As users
  I want to create channels and add members
  So that team members can communicate in shared spaces

  @channel-create
  Scenario: User1 creates a new channel with User2
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat"
    And I click on "[data-testid='create-new-channel']"
    And I type "user:user1-browser.id" on the element "[data-testid='channel-name-input']"
    And I click on "[data-testid='create-channel-button']"
    Then the user should be redirected to "/chat/"
    And I should see "user:user1-browser.id" in the element "[data-testid='channel-list']"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I store the current path as "user1-channel-1"
