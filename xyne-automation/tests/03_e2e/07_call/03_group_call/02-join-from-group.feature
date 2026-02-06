@e2e @call @call-joining
Feature: Join Call from Group Chat
  As a user
  I want to join a call from a group chat
  So that I can have a group conversation with multiple participants

  @join-from-notification
  Scenario Outline: <user> can join a call from notification
    Given using browser "<browser>"
    Then the element with role dialog should be open
    When I click the accept call button
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |

  @join-from-group
  Scenario: User2 can join a call from group chat via start button
    Given using browser "user2-browser"
    When I open the Xyne-Space at "group-chat-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='start-call-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @join-from-group
  Scenario: User3 can join a call from group chat via conversation list
    Given using browser "user3-browser"
    And I dismiss any open dialog
    When I open the Xyne-Space at "group-chat-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='join-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @end-call-user1
  Scenario: User1 can end a call
    Given using browser "user1-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"