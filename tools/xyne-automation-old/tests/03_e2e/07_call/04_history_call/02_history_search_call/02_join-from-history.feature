@e2e @call @call-joining
Feature: Join Call from History Search
  As a user
  I want to join a call from my call history by searching for a participant
  So that I can quickly reconnect with previous call participants

@join-from-history-notification
  Scenario Outline: <user> can decline a call from notification
    Given using browser "<browser>"
    And I wait for "[data-testid='incoming-call-modal']" to appear
    When I click on "button:has(svg.lucide-phone-off)"
    Then I should not see "[data-testid='incoming-call-modal']"

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |

@join-from-history
  Scenario: User2 can join a call from history
    Given using browser "user2-browser"
    When I open the Xyne-Space at "/calls"
    Then I should see the element "[data-testid='call-history-list']"
    And I click on "[data-testid='call-join-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"

  Scenario: User3 can join a call from history
    Given using browser "user3-browser"
    When I open the Xyne-Space at "/calls"
    And I dismiss any open dialog
    Then I should see the element "[data-testid='call-history-list']"
    And I click on "[data-testid='call-join-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 3 participant in the element "[data-testid='participant-count']"
