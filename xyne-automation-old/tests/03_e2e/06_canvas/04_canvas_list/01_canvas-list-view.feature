@e2e @canvas @canvas-list
Feature: Canvas List View
  As a user
  I want to view all canvases in a channel
  So that I can access and manage my documents

  @canvas-list-view-header
  Scenario: User views canvas list header
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on text "Canvas"
    And I wait for "[data-testid='canvas-list-header']" to appear
    Then I should see "Channel Canvases" in the element "[data-testid='canvas-list-header']"
    And I should see a button with text "New Canvas"

  @canvas-list-select-canvas
  Scenario: User selects canvas from list
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    Then I should see the element "[data-testid='canvas-editor']"

  @canvas-list-filter-my-canvases
  Scenario: User filters to see only their created canvases
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I wait for "[data-testid='chat-list-loading']" to disappear
    And I click on text "Canvas"
    And I wait for "[data-testid='canvas-list']" to appear
    And I click on "[data-testid='canvas-filter-created-by-me']"
    Then I should see the element "[data-testid='canvas-list']"
