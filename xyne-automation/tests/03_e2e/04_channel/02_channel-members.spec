# Channel Members E2E Flow
> Add members to channels and verify they can see and access the channel

## Channel owner adds user and user sees channel in their list
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel "channel-visibility-test" for user "user-1" in project "project-1"
* clicking on "[data-testid='channel-info-trigger']"
* clicking on "[data-testid='add-people-button']"
* typing stored user "user-2" field "email" in "[data-testid='user-search-input']"
* clicking on stored user "user-2" field "name" in "[data-testid='user-search-results']"
* clicking on "[data-testid='add-people-submit']"
* switching to temp browser "user2-browser-1"
* Navigating to chat
* verifying stored user "user-1" channel "channel-visibility-test" field "name" is visible in "[data-testid='channel-list']"
* Switching to main browser
