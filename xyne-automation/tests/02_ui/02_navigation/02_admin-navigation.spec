# Admin Navigation UI Test
> Verify admin-only navigation menu items load correct pages

## Admin navigates to User Management page
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "user-management"
* waiting for "[data-testid='user-management-page']" to appear
* verifying "User Management" is visible in "[data-testid='user-management-page']"
* verifying "User" is visible in "[data-testid='user-management-page']"
* verifying "Team" is visible in "[data-testid='user-management-page']"
* verifying "Manager" is visible in "[data-testid='user-management-page']"
* verifying "Role" is visible in "[data-testid='user-management-page']"
* verifying "Actions" is visible in "[data-testid='user-management-page']"

## Admin navigates to Analytics page
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "analytics"
* waiting for "[data-testid='analytics-page']" to appear
* verifying "Analytics" is visible in "[data-testid='analytics-page']"
* verifying "Active Users" is visible in "[data-testid='analytics-page']"
* verifying "Active Messages" is visible in "[data-testid='analytics-page']"
* verifying "Number of Calls" is visible in "[data-testid='analytics-page']"

## Admin navigates to Projects Board
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring project "project-1" exists in fixture for user "admin-1"
* navigating via sidebar to "tickets"
* clicking on text "user:admin-1.projects.project-1.name" in "[data-testid^='project-item-']"
* waiting for "[data-testid='projects-board-page']" to appear

## Admin navigates to List Projects view
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "list-projects"
* waiting for "[data-testid='list-projects-page']" to appear

## Admin navigates to Forms page
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "forms"
* waiting for "[data-testid='forms-page']" to appear
* verifying "Forms" is visible in "[data-testid='forms-page']"

## Admin navigates to Support page
* Using browser
* Ensuring user "admin-1" is logged in
* clicking on "[data-testid='nav-support']"
* waiting for "[data-testid='support-page']" to appear
* verifying "Desks" is visible in "[data-testid='support-page']"
* verifying "Select a channel to preview tickets" is visible in "[data-testid='support-page']"

## Admin navigates to Workspace Management page
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "workspace-management"
* waiting for "[data-testid='workspace-management-page']" to appear
* verifying "Workspace Management" is visible in "[data-testid='workspace-management-page']"
* verifying "General & Members" is visible in "[data-testid='workspace-management-page']"

## Admin navigates to Organisations page
* Using browser
* Ensuring user "admin-1" is logged in
* navigating via sidebar to "organisations"
* waiting for "[data-testid='organisations-page']" to appear
* verifying "Organisations" is visible in "[data-testid='organisations-page']"
* verifying "Manage organisations and their members" is visible in "[data-testid='organisations-page']"
* verifying "Create New Org" is visible in "[data-testid='organisations-page']"
* verifying "About Organisations" is visible in "[data-testid='organisations-page']"
