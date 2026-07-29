@e2e @canvas @canvas-deletion @canvas-dm
Feature: DM Canvas Deletion E2E Flow
  As a canvas owner
  I want to delete my canvas
  So that I can remove unwanted documents

  @canvas-delete-view-list
  Scenario: Owner views DM canvas in list before deletion
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-user2-dm"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on text "Canvas"
    And I wait for "[data-testid='canvas-list']" to appear
    Then I should see the element "[data-testid='canvas-list']"
    And I should see "DM Canvas Test" in the element "[data-testid='canvas-list']"
