# User Navigation UI Test
> Verify user-accessible navigation menu items load correct pages

## User adds all user-accessible sidebar items to toolbar via Customize
* Using browser
* Ensuring user "user-1" is logged in
* showing all sidebar items in toolbar
* verifying "[data-testid='nav-xyne-ai']" is visible
* verifying "[data-testid='nav-chat']" is visible
* verifying "[data-testid='nav-dms']" is visible
* verifying "[data-testid='nav-calls']" is visible
* verifying "[data-testid='nav-recordings']" is visible
* verifying "[data-testid='nav-activity']" is visible
* verifying "[data-testid='nav-my-canvas']" is visible
* verifying "[data-testid='nav-automations']" is visible
* verifying "[data-testid='nav-scheduled-messages']" is visible
* verifying "[data-testid='nav-apps']" is visible
* verifying "[data-testid='nav-user-guide']" is visible
* verifying "[data-testid='nav-knowledge-base']" is visible
* verifying "[data-testid='nav-context']" is visible
* verifying "[data-testid='nav-release-manager']" is visible
* verifying "[data-testid='nav-slack-migration']" is visible

## Admin adds all sidebar items to toolbar via Customize
* Using browser
* Ensuring user "admin-1" is logged in
* showing all sidebar items in toolbar
* verifying "[data-testid='nav-xyne-ai']" is visible
* verifying "[data-testid='nav-chat']" is visible
* verifying "[data-testid='nav-dms']" is visible
* verifying "[data-testid='nav-calls']" is visible
* verifying "[data-testid='nav-recordings']" is visible
* verifying "[data-testid='nav-tickets']" is visible
* verifying "[data-testid='nav-sdlc']" is visible
* verifying "[data-testid='nav-support']" is visible
* verifying "[data-testid='nav-activity']" is visible
* verifying "[data-testid='nav-my-canvas']" is visible
* verifying "[data-testid='nav-automations']" is visible
* verifying "[data-testid='nav-scheduled-messages']" is visible
* verifying "[data-testid='nav-user-groups']" is visible
* verifying "[data-testid='nav-user-management']" is visible
* verifying "[data-testid='nav-workspace-management']" is visible
* verifying "[data-testid='nav-tag-review']" is visible
* verifying "[data-testid='nav-organisations']" is visible
* verifying "[data-testid='nav-analytics']" is visible
* verifying "[data-testid='nav-forms']" is visible
* verifying "[data-testid='nav-apps']" is visible
* verifying "[data-testid='nav-user-guide']" is visible
* verifying "[data-testid='nav-insights']" is visible
* verifying "[data-testid='nav-knowledge-base']" is visible
* verifying "[data-testid='nav-context']" is visible
* verifying "[data-testid='nav-dashboards']" is visible
* verifying "[data-testid='nav-list-projects']" is visible
* verifying "[data-testid='nav-release-manager']" is visible
* verifying "[data-testid='nav-jira-migration']" is visible
* verifying "[data-testid='nav-whatsapp-migration']" is visible
* verifying "[data-testid='nav-slack-migration']" is visible

## User navigates to Recordings page
* Using browser
* Ensuring user "user-1" is logged in
* showing all sidebar items in toolbar
* navigating via sidebar to "recordings"
* waiting for "[data-testid='recordings-v2-page']" to appear
* verifying "Xyne Scribe" is visible in "[data-testid='recordings-v2-page']"
* verifying "Start your first recording" is visible in "[data-testid='recordings-v2-page']"

## User navigates to Context page
* Using browser
* Ensuring user "user-1" is logged in
* showing all sidebar items in toolbar
* navigating via sidebar to "context"
* waiting for "[data-testid='context-page']" to appear
* verifying "Context" is visible in "[data-testid='context-page']"
* verifying "Upload Docs" is visible in "[data-testid='context-page']"
* verifying "Query" is visible in "[data-testid='context-page']"
* verifying "Summary" is visible in "[data-testid='context-page']"
* verifying "Scope" is visible in "[data-testid='context-page']"
* verifying "Doc Type" is visible in "[data-testid='context-page']"

## User navigates to Scheduled Messages page
* Using browser
* Ensuring user "user-1" is logged in
* showing all sidebar items in toolbar
* navigating via sidebar to "scheduled-messages"
* waiting for "[data-testid='scheduled-messages-page']" to appear
* verifying "Scheduled Messages" is visible in "[data-testid='scheduled-messages-page']"
* verifying "Scheduled" is visible in "[data-testid='scheduled-messages-page']"

## User navigates to Apps page
* Using browser
* Ensuring user "user-1" is logged in
* showing all sidebar items in toolbar
* navigating via sidebar to "apps"
* waiting for "[data-testid='apps-page']" to appear
* verifying "Xyne Apps" is visible in "[data-testid='apps-page']"
* verifying "Manage your xyne-apps" is visible in "[data-testid='apps-page']"
