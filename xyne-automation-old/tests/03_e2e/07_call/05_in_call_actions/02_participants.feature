@e2e @call @call-participants
Feature: Call Participants Management (Deep Dive)
  As a user in an active call
  I want to manage participants and share meeting links
  So that I can control who joins and invite others

  @verify-active-call
  Scenario: Verify Active call
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    Then I should see the element "[data-testid='call-history-list']"
    And I should see "Ongoing" in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='call-join-button']"
    And I wait for "[data-testid='call-window']" to appear

  @call-controls-end
  Scenario: End call from controls
    And I click on "[data-testid='end-call-button']"
    And I wait for "[data-testid='end-call-modal']" to appear
    And I click the button with text "Just leave the call"
    Then I should not see "[data-testid='call-window']"
    Given using browser "user2-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"
    Given using browser "user3-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

  @start-call
  Scenario: User1 starts a call with user2
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    And I type "user:user2-browser.name" on the element "[data-testid='user-search-input']"
    And I click on the first button in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='start-call-button']"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 1 participant in the element "[data-testid='participant-count']"
  
  @reject-call
  Scenario: User2 rejects a call
    Given using browser "user2-browser"
    And I wait for "[data-testid='incoming-call-modal']" to appear
    When I click on "button:has(svg.lucide-phone-off)"
    Then I should not see "[data-testid='incoming-call-modal']"

  @call-participants-add
  Scenario: Add a participant by search
    Given using browser "user1-browser"
    And I click on "[data-testid='add-participant-button']"
    And I click on "[data-testid='add-people-button']"
    Then I wait for "[data-testid='invite-to-call-modal']" to appear
    When I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I click on "[id='search-option-0']"
    Then I should see "user:user3-browser.name" in the selected users badges
    When I click on "[data-testid='invite-button']"

  @call-participants-add @call-participants-add-verify
  Scenario: User3 should receive call notification
    Given using browser "user3-browser"
    And I wait for "[data-testid='incoming-call-modal']" to appear
    When I click on "button:has(svg.lucide-phone)"
    Then I wait for "[data-testid='call-window']" to appear
    And I should see atleast 2 participant in the element "[data-testid='participant-count']"

  @call-participants-already-in-call
  Scenario: User already in call does not receive call notification
    Given using browser "user1-browser"
    And I click on "[data-testid='add-people-button']"
    Then I wait for "[data-testid='invite-to-call-modal']" to appear
    When I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I click on "[id='search-option-0']"
    Then I should see "user:user3-browser.name" in the selected users badges
    When I click on "[data-testid='invite-button']"
    Then I should not see "[data-testid='invite-to-call-modal']"
  
  @call-participants-add @call-participants-add-verify
  Scenario: User3 should not receive call notification
    Given using browser "user3-browser"
    Then I should not see "[data-testid='incoming-call-modal']"

  