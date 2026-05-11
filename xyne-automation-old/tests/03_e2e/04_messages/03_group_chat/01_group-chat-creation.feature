@e2e @messaging @group-chat
Feature: Group Chat Creation E2E Flow
  As a user
  I want to create a group DM with multiple users
  So that we can communicate together in a single conversation

  @group-chat-create
  Scenario: User1 creates a group DM with User2 and User3 and sends a message
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat"
    And I click on "[data-testid='create-new-dm']"
    And I type "user:user2-browser.email" on the element "[data-testid='user-search-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
    And I type "user:user3-browser.email" on the element "[data-testid='user-search-input']"
    And I click on text "user:user3-browser.name" in the element "[data-testid='user-search-results']"
    And I wait for "[data-testid='message-input']" to appear
    And I type "Hello everyone from user1!" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I wait for "[data-testid='virtuoso-item-list']" to appear
    Then I should see "Hello everyone from user1!" in the element "[data-testid='virtuoso-item-list']"
    And I should see "user:user2-browser.name, user:user3-browser.name" in the element "[data-testid='dm-list']"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I store the current path as "group-chat-1"
