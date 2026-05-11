@e2e @project
Feature: Project Creation E2E Flow
  As an admin user
  I want to create a project
  So that channels can be associated with projects

  @project-create
  Scenario: Admin creates a new project
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/listprojects"
    And I click the button with text "New"
    And I type "user:admin-browser.name - Project" on the element "input[placeholder*='Enter project name']"
    And I type "PROJ-user:admin-browser.id" on the element "[data-testid='project-code-input']"
    And I type "A test project for channel creation" on the element "textarea[placeholder*='Enter project description']"
    And I click the button with text "Create Project"
    Then I should see "user:admin-browser.name - Project" in the element "body"

  @project-create @project-create-verify
  Scenario: Admin sees the project in their projects list
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/listprojects"
    Then I should see "user:admin-browser.name - Project" in the element "body"

  @project-create @configure-board-eta
  Scenario: Admin enables ETA for all board stages
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/listprojects"
    And I click on text "user:admin-browser.name - Project" in the element "[data-testid^='project-card-']"
    And I wait for 2 seconds
    And I click on "[data-testid='edit-board-button']"
    And I click the button with text "Next"
    # Set ETA for the first 3 stages to enable stage ETA in tickets
    And I click the button with text "Set ETA"
    And I type "24" on the element "input[data-track-name='edit_eta_input']"
    And I press "Enter"
    And I wait for 1 seconds
    And I click on "[data-track-name='start_edit_eta']"
    And I type "24" on the element "input[data-track-name='edit_eta_input']"
    And I press "Enter"
    And I wait for 1 seconds
    And I click on "[data-track-name='start_edit_eta']"
    And I type "24" on the element "input[data-track-name='edit_eta_input']"
    And I press "Enter"
    And I click the button with text "Finish"
    Then I should see "user:admin-browser.name - Project" in the element "body"
