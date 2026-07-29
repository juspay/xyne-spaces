@e2e @canvas @canvas-creation @canvas-dm
Feature: DM Canvas Creation E2E Flow
  As a user
  I want to create a new canvas from a direct message
  So that I can write and collaborate on documents

  @canvas-create
  Scenario: User creates a new canvas from DM
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on text "Canvas"
    And I click on text "New Canvas"
    Then the user should be redirected to "/canvas/"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I should see the element "[data-testid='canvas-editor']"
    And I should see the element "[data-testid='canvas-title-input']"
    And I click on "[data-testid='canvas-title-input']"
    And I clear the text in "[data-testid='canvas-title-input']"
    And I type "DM Canvas Test" on the element "[data-testid='canvas-title-input']"
    And I click on "[data-testid='canvas-editor']"
    And I wait for 2 seconds
    And I store the current path as "canvas-created-in-dm"

  @canvas-create @canvas-owner
  Scenario: DM canvas creator has owner role
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-in-dm"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "Owner" in the element "[data-testid='canvas-share-modal']"
