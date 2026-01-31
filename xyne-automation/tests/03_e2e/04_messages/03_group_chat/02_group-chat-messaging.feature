@e2e @messaging @group-chat
Feature: Group Chat Messaging E2E Flow
  As a user
  I want to send messages in a group chat
  So that all members can see and respond to my messages

  @group-chat-send
  Scenario: User1 sends a message in the group chat
    Given using browser "user1-browser"
    When I open the Xyne-Space at "group-chat-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I type "Hello everyone from user1!" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I wait for 1 seconds
    Then I should see "Hello everyone from user1!" in the element "[data-testid='virtuoso-item-list']"

  @group-chat-send @group-chat-receive-verify
  Scenario Outline: <user> sees the message in the group chat
    Given using browser "<browser>"
    When I open the Xyne-Space at "group-chat-1"
    Then I should see "Hello everyone from user1!" in the element "[data-testid='virtuoso-item-list']"

    Examples:
      | user  | browser       |
      | User1 | user1-browser |
      | User2 | user2-browser |
      | User3 | user3-browser |
