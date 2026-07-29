@e2e @call @call-joining
Feature: Join Call from Channel
  As a user
  I want to join a call from a channel
  So that I can communicate with channel members in real-time

  @join-from-channel
  Scenario: User2 can join a call from a channel via start button
    Given using browser "user2-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='start-call-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @join-from-channel
  Scenario: User3 can join a call from a channel via conversation list
    Given using browser "user3-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='join-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @end-call-user1
  Scenario: User1 can end a call
    Given using browser "user1-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"