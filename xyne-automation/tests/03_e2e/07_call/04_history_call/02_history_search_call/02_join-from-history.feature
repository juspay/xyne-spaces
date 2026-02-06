@e2e @call @call-joining
Feature: Join Call from History Search
  As a user
  I want to join a call from my call history by searching for a participant
  So that I can quickly reconnect with previous call participants

@join-from-history-notification
  Scenario Outline: <user> can decline a call from notification
    Given using browser "<browser>"
    Then the element with role dialog should be open
    When I click the decline call button
    Then the element with role dialog should be closed

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |

@join-from-history
  Scenario: User2 can join a call from history
    Given using browser "user2-browser"
    And I dismiss any open dialog
    When I open the Xyne-Space at "/calls"
    Then I should see active call in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='Active']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"

  Scenario: User3 can join a call from history
    Given using browser "user3-browser"
    And I dismiss any open dialog
    When I open the Xyne-Space at "/calls"
    Then I should see active call in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='Active']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 3 participant in the element "[data-testid='participant-count']"
