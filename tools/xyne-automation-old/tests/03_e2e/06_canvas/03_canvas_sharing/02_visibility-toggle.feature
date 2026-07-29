@e2e @canvas @canvas-sharing @canvas-visibility
Feature: Canvas Visibility Toggle
  As a canvas owner
  I want to control canvas visibility
  So that I can manage who can access my documents

  @canvas-visibility-toggle-visible
  Scenario: Owner can see visibility control
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "Make canvas public" in the element "[data-testid='canvas-share-modal']"
    And I should see the element "[data-testid='canvas-visibility-public-button']"

  @canvas-visibility-toggle-changes-state
  Scenario: Owner can toggle visibility with the public button
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    And I click on "[data-testid='canvas-visibility-public-button']"
    Then I should see "Make canvas private" in the element "[data-testid='canvas-share-modal']"
    And I should see the element "[data-testid='canvas-visibility-public-button']"
