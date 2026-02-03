@e2e @canvas @canvas-sharing @canvas-dm
Feature: DM Canvas Sharing with Users
  As a canvas owner
  I want to share my canvas with other users
  So that we can collaborate on documents

  @canvas-share-modal
  Scenario: DM Owner opens share modal and sees all elements
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-in-dm"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "People with access" in the element "[data-testid='canvas-share-modal']"
    And I should see "Owner" in the element "[data-testid='canvas-share-modal']"
    And I should see the element "[data-testid='user-search-input']"

  @canvas-share-add-viewer
  Scenario: DM Owner adds a user as Viewer
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-in-dm"
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
