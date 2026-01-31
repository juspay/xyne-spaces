@e2e @messaging @dm
Feature: DM Messaging E2E Flow
  As a user
  I want to send direct messages to another user
  So that we can communicate privately

  @dm-send
  Scenario: User1 sends a message in the DM
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I type "Hello from user1!" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I wait for 1 seconds
    Then I should see "Hello from user1!" in the element "[data-testid='virtuoso-item-list']"

  @dm-send @dm-receive-verify
  Scenario Outline: <user> sees the message in the DM
    Given using browser "<browser>"
    When I open the Xyne-Space at "user1-user2-dm"
    Then I should see "Hello from user1!" in the element "[data-testid='virtuoso-item-list']"

    Examples:
      | user  | browser       |
      | User1 | user1-browser |
      | User2 | user2-browser |
