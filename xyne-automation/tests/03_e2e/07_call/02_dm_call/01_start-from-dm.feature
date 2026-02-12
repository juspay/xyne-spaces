@e2e @call @call-initiation
Feature: Start Call from Direct Message
  As a user
  I want to start a call from a direct message conversation
  So that I can quickly switch to a voice/video call with someone

  @start-from-dm
  Scenario: User can start a call from DM
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='start-call-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @start-from-dm @start-from-dm-verify
  Scenario: User2 sees the call in the DM
    Given using browser "user2-browser"
    And I wait for "[role='dialog'][aria-modal='true']" to appear