@e2e @call @call-initiation
Feature: Start Call from History Search
  As a user
  I want to start a call from my call history by searching for a participant
  So that I can quickly reconnect with previous call participants

  @start-from-history-search
  Scenario: User can start a call from history by searching for participants
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    And I click on "[data-testid='new-call-button']"
    And I click on "[data-testid='start-instant-call-option']"
    And I type "user:user2-browser.name" on the element "[data-testid='search-participants-input']"
    And I click on "[data-testid='search-participants-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='participant-search-results']"
    And I type "user:user3-browser.name" on the element "[data-testid='search-participants-input']"
    And I click on text "user:user3-browser.name" in the element "[data-testid='participant-search-results']"
    And I click on "[data-testid='search-participants-input']"
    And I click on "[data-testid='instant-call-start-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @start-from-history @start-from-history-verify
  Scenario Outline: <user> receives call notification
    Given using browser "<browser>"
    And I wait for "[data-testid='incoming-call-modal']" to appear

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |
