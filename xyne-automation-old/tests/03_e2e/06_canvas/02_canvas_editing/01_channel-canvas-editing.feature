@e2e @canvas @canvas-editing @canvas-channel
Feature: Channel Canvas Editing E2E Flow
  As a user
  I want to edit canvas content
  So that I can create rich documents

  @canvas-edit-text
  Scenario: User adds text content to channel canvas
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    And I click on "[data-testid='canvas-editor'] .bn-editor"
    And I type "Hello, this is a test canvas content" on the element "[data-testid='canvas-editor'] [contenteditable='true']"
    # Explicit wait since no indicator is there
    And I wait for 2 seconds
    Then I should see "Hello, this is a test canvas content" in the element "[data-testid='canvas-editor']"

  @canvas-edit-persist
  Scenario: Channel canvas content persists on page reload
    Given using browser "user1-browser"
    When I open the Xyne-Space at "canvas-created-by-user1-in-channel-1"
    And I wait for "[data-testid='canvas-editor']" to appear
    Then I should see "Hello, this is a test canvas content" in the element "[data-testid='canvas-editor']"
