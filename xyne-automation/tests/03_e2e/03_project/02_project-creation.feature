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
    And I type "A test project for channel creation" on the element "textarea[placeholder*='Enter project description']"
    And I click the button with text "Create Project"
    Then I should see "user:admin-browser.name - Project" in the element "body"

  @project-create @project-create-verify
  Scenario: Admin sees the project in their projects list
    Given using browser "admin-browser"
    When I open the Xyne-Space at "/listprojects"
    Then I should see "user:admin-browser.name - Project" in the element "body"
