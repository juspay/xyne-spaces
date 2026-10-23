# Channel Leave And Remove E2E Flow
> A member can leave a channel, and the owner can remove a member; either way the channel leaves the member's list.

## Member leaves a channel -> it disappears from their channel list
* Using browser
* Logging in user "user-2" on temp browser "leave-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel "channel-leave" for user "user-1" in project "project-1"
* Adding user "user-2" to the open channel
* switching to temp browser "leave-browser-1"
* Navigating to chat
* verifying stored user "user-1" channel "channel-leave" field "name" is visible in "[data-testid='channel-list']"
* clicking on stored channel "channel-leave" name for user "user-1"
* waiting for "[data-testid='channel-info-trigger']" to appear
* clicking on "[data-testid='channel-info-trigger']"
* clicking on "[data-testid='channel-leave-button']"
* verifying stored user "user-1" channel "channel-leave" field "name" is not visible in "[data-testid='channel-list']"

## Owner removes a member -> the channel disappears from the member's channel list
* Using browser
* Logging in user "user-2" on temp browser "remove-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel "channel-remove-member" for user "user-1" in project "project-1"
* Adding user "user-2" to the open channel
* switching to temp browser "remove-browser-1"
* Navigating to chat
* verifying stored user "user-1" channel "channel-remove-member" field "name" is visible in "[data-testid='channel-list']"
* Switching to main browser
* removing stored user "user-2" from the open channel
* switching to temp browser "remove-browser-1"
* verifying stored user "user-1" channel "channel-remove-member" field "name" is not visible in "[data-testid='channel-list']"
