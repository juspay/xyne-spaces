@e2e @activity-dm
Feature: Activity DM - Create DM and send messages 

  Background:
    Given using browser "admin-browser"

  Scenario: Create DM and send messages
    When I open the Xyne-Space at "/chat/dir"
    And I click on "[data-testid='open-dms-button']"
    Then I wait for "[data-testid='dms-heading']" to appear
    And I should see the element "[data-testid='create-new-message-btn']"
    And I should see the element "[data-testid='search-messages-input']"
    And I should see the element "[data-testid='dms-go-back-link']"
    And I click on "[data-testid='create-new-message-btn']"
    And I click on "[data-testid='user-search-input']"
    And I type "user:user1-browser.name" on the element "[data-testid='user-search-input']"
    And I click on text "user:user1-browser.name" in the element "[data-testid='user-search-results']"
    And I clear the text in "[data-testid='user-search-input']"
    And I click on "[data-testid='dm-message-textarea']"
    And I type "test message " on the element "[data-testid='dm-message-textarea']"
    And I click on "[data-testid='start-dm-btn']"
    And I click on "[data-testid='message-input']"
    And I type "hi " on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I click on "[data-testid='message-input']"
    And I type "this is test" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    
    
