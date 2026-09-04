# Group Calls E2E Flow
> Initiate and join calls from a group conversation.

## User starts call from group chat
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Logging in user "user-3" on temp browser "user3-browser-1"
* Ensuring user "user-1" is logged in
* Opening group DM with users "user-2" and "user-3"
* typing "Hello team" in "[data-testid='message-input']"
* clicking on "[data-testid='send-message-button']"
* waiting for "[data-testid='start-call-button']" to appear
* clicking on "[data-testid='start-call-button']"
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* verifying "[data-testid='participant-count']" is visible

## User joins ongoing group call
tags: quarantine
* Using browser
* Logging in user "user-1" on temp browser "caller-browser-1"
* Logging in user "user-3" on temp browser "user3-browser-1"
* Ensuring user "user-2" is logged in
* switching to temp browser "caller-browser-1"
* Opening group DM with users "user-2" and "user-3"
* typing "Hello team" in "[data-testid='message-input']"
* clicking on "[data-testid='send-message-button']"
* waiting for "[data-testid='virtuoso-item-list']" to appear
* waiting for "[data-testid='start-call-button']" to appear
* clicking on "[data-testid='start-call-button']"
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* Switching to main browser
* waiting for "[data-testid='incoming-call-modal']" to appear
* clicking on "[data-track-name='ACCEPT_INCOMING_CALL']"
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
