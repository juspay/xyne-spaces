@e2e @bookmark
Feature: Bookmark functionality for messages

  Background:
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/chat/dir/"
  Scenario: Create, mark as done, and remove bookmark from a message
    When I hover on the element "button:has-text('Direct Messages')"
    And I click on "[data-testid='create-new-dm']"
    And I type "user:user2-browser.name" on the element "[data-testid='user-search-input']"
    And I click on text "user:user2-browser.name" in the element "[data-testid='user-search-results']"
    And I click on "[data-testid='message-input']"
    And I type "hellooo pls bookmark this" on the element "[data-testid='message-input']"
    And I click on "[data-testid='send-message-button']"
    And I wait for "text=\"hellooo pls bookmark this\"" to appear
    And I hover on the text "hellooo pls bookmark this" at index 1
    And I wait for 1 seconds
    And I click on "[data-testid='hover-action-more']"
    And I click on "[data-testid='hover-action-add-bookmark']"
    And I click on "[data-testid='open-bookmarks-button']"
    And I hover on the element "[data-testid^='bookmark-item-']"
    And I click on "[data-testid='bookmark-mark-as-done-btn']"
    And I click on "[data-testid='bookmarks-go-back-link']"
    And I hover on the text "hellooo pls bookmark this" at index 1
    And I wait for 1 seconds
    And I click on "[data-testid='hover-action-more']"
    And I click on "[data-testid='hover-action-add-bookmark']"
