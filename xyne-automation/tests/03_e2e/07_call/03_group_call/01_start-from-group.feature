@e2e @call @call-initiation
Feature: Start Call from Group Chat
  As a user
  I want to start a call from a group chat
  So that I can have a group conversation with multiple participants

  @start-from-group
  Scenario: User can start a call from a group chat
    Given using browser "user1-browser"
    When I open the Xyne-Space at "group-chat-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='start-call-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @start-from-group @start-from-group-verify
  Scenario Outline: <user> sees the call in the group chat
    Given using browser "<browser>"
    Then the element with role dialog should be open

    Examples:
      | user  | browser       |
      | User2 | user2-browser |
      | User3 | user3-browser |
