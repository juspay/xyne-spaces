# Project Creation E2E Flow
> As an admin user, I want to create a project so that channels can be associated with projects.

## Admin sees the created project in their projects list
* using browser
* Ensuring user "admin-1" is logged in
* Creating project "project-e2e" for user "admin-1"
* navigating via sidebar to "list-projects"
* verifying stored user "admin-1" project "project-e2e" field "name" is visible in "body"

## Admin opens project board for editing
* using browser
* Ensuring user "admin-1" is logged in
* Creating project "project-e2e" for user "admin-1"
* navigating via sidebar to "list-projects"
* clicking on text "user:admin-1.projects.project-e2e.name" in "[data-testid^='project-card-']"
* waiting for "2" seconds
* clicking on "[data-testid='edit-board-button']"
* verifying stored user "admin-1" project "project-e2e" field "name" is visible in "body"
