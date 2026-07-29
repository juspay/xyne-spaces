@e2e @call @call-initiation
Feature: Start Call from Channel
  As a user
  I want to start a call from a channel
  So that I can communicate with channel members in real-time

  @start-from-channel
  Scenario: User can start a call from a channel
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='start-call-button']"
    And I click on "[data-testid='confirm-call-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @start-from-channel @start-from-channel-verify
  Scenario Outline: <user> sees the call in the channel
    Given using browser "<browser>"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    Then I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |