# DM Calls E2E Flow
> Initiate and join calls from a direct message conversation.

## User starts call from DM
* Using browser
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* waiting for "[data-testid='start-call-button']" to appear
* clicking on "[data-testid='start-call-button']"
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* verifying "[data-testid='participant-count']" is visible

## User joins ongoing call from DM
tags: quarantine
* Using browser
* Logging in user "user-1" on temp browser "caller-browser-1"
* Ensuring user "user-2" is logged in
* switching to temp browser "caller-browser-1"
* opening baseline DM for user "user-1"
* waiting for "[data-testid='start-call-button']" to appear
* clicking on "[data-testid='start-call-button']"
* waiting for network to be idle
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* Switching to main browser
* waiting for "[data-testid='incoming-call-modal']" to appear
* clicking on "[data-track-name='ACCEPT_INCOMING_CALL']"
* waiting for "[data-testid='incoming-call-modal']" to disappear
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
