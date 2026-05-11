# User Navigation UI Test
> Verify user-accessible navigation menu items load correct pages

## User navigates to Recordings page
* Using browser
* Ensuring user "user-1" is logged in
* clicking on "[data-testid='nav-recordings']"
* waiting for "[data-testid='recordings-page']" to appear
* verifying "Recordings" is visible in "[data-testid='recordings-page']"
* verifying "Your audio recordings with automatic transcription" is visible in "[data-testid='recordings-page']"
* verifying "STT:" is visible in "[data-testid='recordings-page']"
* verifying "No recordings yet" is visible in "[data-testid='recordings-page']"

## User navigates to Context page
* Using browser
* Ensuring user "user-1" is logged in
* clicking on "[data-testid='nav-context']"
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
* clicking on "[data-testid='nav-scheduled-messages']"
* waiting for "[data-testid='scheduled-messages-page']" to appear
* verifying "Scheduled Messages" is visible in "[data-testid='scheduled-messages-page']"
* verifying "Scheduled" is visible in "[data-testid='scheduled-messages-page']"

## User navigates to Apps page
* Using browser
* Ensuring user "user-1" is logged in
* clicking on "[data-testid='nav-apps']"
* waiting for "[data-testid='apps-page']" to appear
* verifying "Xyne Apps" is visible in "[data-testid='apps-page']"
* verifying "Manage your xyne-apps" is visible in "[data-testid='apps-page']"
