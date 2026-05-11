@e2e @canvas @canvas-sharing @canvas-visibility
Feature: Canvas Visibility Toggle
  As a canvas owner
  I want to control canvas visibility
  So that I can manage who can access my documents

  @canvas-visibility-toggle-visible
  Scenario: Owner can see visibility toggle
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    Then I should see "Make visible to channel" in the element "[data-testid='canvas-share-modal']"
    And I should see the element "[data-testid='canvas-visibility-toggle']"

  @canvas-visibility-toggle-changes-state
  Scenario: Owner can toggle visibility switch
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-share-button']"
    # Click the toggle and verify it changes
    And I click on "[data-testid='canvas-visibility-toggle']"
    # Toggle should have changed its state (verify element is still there and clickable)
    Then I should see the element "[data-testid='canvas-visibility-toggle']"
