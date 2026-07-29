@e2e @canvas @canvas-sharing @canvas-channel
Feature: Channel Canvas Sharing with Users
  As a canvas owner
  I want to share my canvas with other users
  So that we can collaborate on documents

  @canvas-share-modal
  Scenario: Channel Owner opens share modal and sees all elements
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "Make canvas public" in the element "[data-testid='canvas-share-modal']"
    And I should see "Users with access" in the element "[data-testid='canvas-share-modal']"
    And I should see "Owner" in the element "[data-testid='canvas-share-modal']"
    And I should see the element "[data-testid='user-search-input']"

  @canvas-share-copy-link
  Scenario: Channel Owner can copy shareable link
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    And I click on "[data-testid='canvas-copy-link-button']"
    Then I should see the element "[data-testid='canvas-copy-link-button']"

  @canvas-share-add-viewer
  Scenario: Channel Owner adds a user as Viewer
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    And I type "user:user2-browser.name" on the element "[data-testid='user-search-input']"
    And I wait for "[data-testid='user-search-results']" to appear
    And I click on "[data-testid='user-search-results'] li:first-child"
    Then I should see "Add as:" in the element "[data-testid='canvas-share-modal']"
    And I should see a button with text "Viewer"
    And I should see a button with text "Editor"
    When I click the button with text "Viewer"
    Then I should see a button with text "Viewer"

  @canvas-share-add-editor
  Scenario: Channel Owner adds another user as Editor
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    And I type "user:user3-browser.name" on the element "[data-testid='user-search-input']"
    And I wait for "[data-testid='user-search-results']" to appear
    And I click on "[data-testid='user-search-results'] li:first-child"
    And I click the button with text "Editor"
    Then I should see a button with text "Editor"
