@e2e @canvas @canvas-creation @canvas-channel
Feature: Channel Canvas Creation E2E Flow
  As a user
  I want to create a new canvas from a channel
  So that I can write and collaborate on documents

  @canvas-create
  Scenario: User creates a new canvas from channel
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on text "Canvas"
    And I click on text "New Canvas"
    Then the user should be redirected to "/canvas/"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I should see the element "[data-testid='canvas-title-input']"
    And I click on "[data-testid='canvas-title-input']"
    And I clear the text in "[data-testid='canvas-title-input']"
    And I type "Channel Canvas Test" on the element "[data-testid='canvas-title-input']"
    And I click on "[data-testid='canvas-editor']"
    And I wait for 2 seconds
    And I store the current path as "canvas-created-by-user1-in-channel-1"

  @canvas-create @canvas-owner
  Scenario: Channel canvas creator has owner role
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "Owner" in the element "[data-testid='canvas-share-modal']"
