@e2e @canvas @my-canvas
Feature: My Canvas View
  As a user
  I want to view all my canvases across channels
  So that I can access my documents from one place

  @my-canvas-navigate
  Scenario: User navigates to My Canvas view
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat/canvas"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    Then I should see the element "[data-testid='canvas-list']"

  @my-canvas-list-all
  Scenario: User sees all their canvases from Channels and DMs
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat/canvas"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    Then I should see the element "[data-testid='canvas-list']"
    And I should see "Channel Canvas Test" in the element "[data-testid='canvas-list']"
    And I should see "DM Canvas Test" in the element "[data-testid='canvas-list']"

  @my-canvas-filter-created
  Scenario: User filters to see only canvases they created
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/chat/canvas"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on "[data-testid='canvas-filter-created-by-me']"
    Then I should see the element "[data-testid='canvas-list']"
    And I should see "Channel Canvas Test" in the element "[data-testid='canvas-list']"
    And I should see "DM Canvas Test" in the element "[data-testid='canvas-list']"
