@e2e @call @call-initiation
Feature: Start Call from Call History
  As a user
  I want to start a call from my call history
  So that I can quickly reconnect with previous call participants

  @start-from-history
  Scenario: User can start a call from history
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    And I wait for "[data-testid='call-history-list']" to appear
    And I click on "[data-testid='call-join-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"
  
  @start-from-history @start-from-history-verify
  Scenario Outline: <user> should recieve call notification
    Given using browser "<browser>"
    And I wait for "[data-testid='incoming-call-modal']" to appear
 
    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |

  