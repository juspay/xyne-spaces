@e2e @messaging @channel
Feature: Channel Messaging E2E Flow
  As a user
  I want to send messages in a channel
  So that team members can see and respond to my messages

  @channel-send
  Scenario: User1 sends a message in the channel
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I type "Hello from user1 in the channel!" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I wait for 1 seconds
    Then I should see "Hello from user1 in the channel!" in the element "[data-testid='virtuoso-item-list']"

  @channel-send @channel-receive-verify
  Scenario Outline: <user> sees the message in the channel
    Given using browser "<browser>"
    When I open the Xyne-Space at "user1-channel-1"
    Then I should see "Hello from user1 in the channel!" in the element "[data-testid='virtuoso-item-list']"

    Examples:
      | user  | browser       |
      | User1 | user1-browser |
      | User2 | user2-browser |
      | User3 | user3-browser |
