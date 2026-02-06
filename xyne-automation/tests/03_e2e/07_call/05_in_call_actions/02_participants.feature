@e2e @call @call-participants
Feature: Call Participants Management (Deep Dive)
  As a user in an active call
  I want to manage participants and share meeting links
  So that I can control who joins and invite others

  @start-call
  Scenario: User1 starts a call with user2
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    And I type "user:user2-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the first button in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='start-call-button']"
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"

  @call-participants-add
  Scenario: Add a participant by search
    Given using browser "user1-browser"
    And I click on "[data-testid='add-participant-button']"
    And I click on "[data-testid='add-people-button']"
    Then I should see the element "[data-testid='invite-to-call-modal']"
    When I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the id "search-option-0"
    Then I should see "user:user3-browser.name" in the selected users badges
    When I click on "[data-testid='invite-button']"

  @call-participants-add @call-participants-add-verify
  Scenario: User3 should receive call notification
    Given using browser "user3-browser"
    Then the element with role dialog should be open
    When I click the accept call button
    Then I should see the element "[data-testid='call-window']"
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"

  @call-participants-already-in-call
  Scenario: User already in call does not receive call notification
    Given using browser "user1-browser"
    And I click on "[data-testid='add-people-button']"
    Then I should see the element "[data-testid='invite-to-call-modal']"
    When I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the id "search-option-0"
    Then I should see "user:user3-browser.name" in the selected users badges
    When I click on "[data-testid='invite-button']"
    Then I should not see "[data-testid='invite-to-call-modal']"
  
  @call-participants-add @call-participants-add-verify
  Scenario: User3 should not receive call notification
    Given using browser "user3-browser"
    Then the element with role dialog should be closed

  @call-controls-end
  Scenario: End call from controls
    Given using browser "user1-browser"
    And I click on "[data-testid='Active']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"
    Given using browser "user3-browser"
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"
