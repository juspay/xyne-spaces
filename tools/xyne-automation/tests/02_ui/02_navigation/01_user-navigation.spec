# User Navigation UI Test
> Verify user-accessible navigation menu items load correct pages

## User navigates to Recordings page
* Using browser
* Ensuring user "user-1" is logged in
* clicking on "[data-testid='nav-recordings']"
* waiting for "[data-testid='recordings-v2-page']" to appear
* verifying "Xyne Scribe" is visible in "[data-testid='recordings-v2-page']"
* verifying "Start your first recording" is visible in "[data-testid='recordings-v2-page']"

## User navigates to Context page
* Using browser
* Ensuring user "user-1" is logged in
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
* navigating via sidebar to "scheduled-messages"
* waiting for "[data-testid='scheduled-messages-page']" to appear
* verifying "Scheduled Messages" is visible in "[data-testid='scheduled-messages-page']"
* verifying "Scheduled" is visible in "[data-testid='scheduled-messages-page']"

## User navigates to Apps page
* Using browser
* Ensuring user "user-1" is logged in
* navigating via sidebar to "apps"
* waiting for "[data-testid='apps-page']" to appear
* verifying "Xyne Apps" is visible in "[data-testid='apps-page']"
* verifying "Manage your xyne-apps" is visible in "[data-testid='apps-page']"
