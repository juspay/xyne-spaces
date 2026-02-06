@e2e @call @call-initiation
Feature: Start Call from History Search
  As a user
  I want to start a call from my call history by searching for a participant
  So that I can quickly reconnect with previous call participants

  @start-from-history-search
  Scenario: User can start a call from history by searching for participants
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    And I type "user:user2-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the first button in the element "[data-testid='call-history-list']"
    And I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the first button in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='start-call-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @start-from-history @start-from-history-verify
  Scenario Outline: <user> receives call notification
    Given using browser "<browser>"
    Then the element with role dialog should be open

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |