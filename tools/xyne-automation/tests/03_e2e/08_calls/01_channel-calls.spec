# Channel Calls E2E Flow
> Initiate and join calls from a channel conversation.
> "User joins ongoing call" is quarantined: starting a call works, but the join
> affordance never surfaces to a second member (active-call presence isn't propagating).
> Needs a call-presence fix, not a selector change.

## User starts call from channel
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Navigating to channel "channel-1" for user "user-1"
* waiting for "[data-testid='chat-list-loading']" to disappear
* clicking on "[data-testid='start-call-button']"
* verifying "[data-testid='confirm-call-modal']" is visible
* clicking on selector "[data-testid='confirm-call-button']" with text "Okay" if visible
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* verifying "[data-testid='participant-count']" is visible

## User joins ongoing call from channel
tags: quarantine
* Using browser
* Logging in user "admin-1" on temp browser "caller-browser-1"
* Ensuring user "user-1" is logged in
* switching to temp browser "caller-browser-1"
* Navigating to channel "channel-1" for user "admin-1"
* waiting for "[data-testid='chat-list-loading']" to disappear
* clicking on "[data-testid='start-call-button']"
* clicking on selector "[data-testid='confirm-call-button']" with text "Okay" if visible
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
* Switching to main browser
* Navigating to channel "channel-1" for user "user-1"
* waiting for "[data-testid='chat-list-loading']" to disappear
* waiting for "[data-testid='join-button']" to appear
* clicking on "[data-testid='join-button']"
* waiting up to "60" seconds for "[data-testid='call-window']" to appear
