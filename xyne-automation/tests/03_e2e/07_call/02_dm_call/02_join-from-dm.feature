@e2e @call @call-joining
Feature: Join Call from Direct Message
  As a user
  I want to join a call from a direct message conversation
  So that I can quickly switch to a voice/video call with someone

  @join-from-notification
  Scenario: User can join a call from notification
    Given using browser "user2-browser"
    Then the element with role dialog should be open
    When I click the accept call button
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @join-from-dm
  Scenario: User2 can join a call from DM via start button
    Given using browser "user2-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I should see "A call is going on" in the element "[data-testid='virtuoso-item-list']"
    And I click on "[data-testid='start-call-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @join-from-dm
  Scenario: User2 can join a call from DM via conversation list
    Given using browser "user2-browser"
    When I open the Xyne-Space at "user1-user2-dm"
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


