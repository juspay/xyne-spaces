@e2e @canvas @canvas-editing @canvas-dm
Feature: DM Canvas Editing E2E Flow
  As a user
  I want to edit canvas content
  So that I can create rich documents

  @canvas-edit-text
  Scenario: User adds text content to DM canvas
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-in-dm"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-editor'] .bn-editor"
    And I type "Hello, this is DM canvas content" on the element "[data-testid='canvas-editor'] [contenteditable='true']"
    # Explicit wait since no indicator is there
    And I wait for 2 seconds
    Then I should see "Hello, this is DM canvas content" in the element "[data-testid='canvas-editor']"

  @canvas-edit-persist
  Scenario: DM canvas content persists on page reload
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-in-dm"
    And I wait for "[data-testid='canvas-editor']" to appear
    Then I should see "Hello, this is DM canvas content" in the element "[data-testid='canvas-editor']"
