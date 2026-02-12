@e2e @call @call-joining
Feature: Join Call from Call History
  As a user
  I want to join a call from my call history
  So that I can quickly reconnect with previous call participants

  @join-from-notification
  Scenario Outline: <user> can join a call from notification
    Given using browser "<browser>"
    And I wait for "[role='dialog'][aria-modal='true']" to appear
    When I click on "button:has(svg.lucide-phone)"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |

  @join-from-history
  Scenario: User can join a call from history
    Given using browser "user2-browser"
    When I open the Xyne-Space at "/calls"
    And I click on the first button in the element "[data-testid='call-history-list']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @join-from-group
  Scenario: User2 can join a call from group chat via start button
    Given using browser "user2-browser"
    When I open the Xyne-Space at "group-chat-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='start-call-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"

  @join-from-group
  Scenario: User3 can join a call from group chat via conversation list
    Given using browser "user3-browser"
    When I open the Xyne-Space at "group-chat-1"
    And I dismiss any open dialog
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='join-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 3 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @end-call-user1
  Scenario: User1 can end a call
    Given using browser "user1-browser"
    And I wait for "[data-testid='call-window']" to appear
    And I click on "[data-testid='end-call-button']"
    And I wait for "[data-testid='end-call-modal']" to appear
    And I click the button with text "End for everyone"
    Then I wait for "[data-testid='call-window']" to disappear

  @end-call-verify
  Scenario: User2 sees the call window disappeared
    Given using browser "user2-browser"
    Then I should not see "[data-testid='call-window']"