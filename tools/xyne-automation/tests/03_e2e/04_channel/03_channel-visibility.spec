# Channel Visibility E2E Flow
> Private channels stay hidden from non-members; public channels can be found in Browse channels and joined.

## Private channel -> a non-member cannot find it in Browse channels, where their own channels show
* Using browser
* Logging in user "user-2" on temp browser "browse-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel "channel-private-hidden" for user "user-1" in project "project-1"
* switching to temp browser "browse-browser-1"
* Searching Browse channels for channel "channel-1" of user "user-1"
* verifying stored user "user-1" channel "channel-1" field "name" is visible in "[data-testid='browse-channels-page']"
* clearing "[data-testid='browse-channels-search']"
* typing stored user "user-1" channel "channel-private-hidden" field "name" in "[data-testid='browse-channels-search']"
* verifying stored user "user-1" channel "channel-private-hidden" field "name" is not visible in "[data-testid='browse-channels-page']"

## Public channel -> a non-member finds it in Browse channels and joins it
* Using browser
* Logging in user "user-2" on temp browser "browse-browser-2"
* Ensuring user "user-1" is logged in
* Creating public channel "channel-public-join" for user "user-1" in project "project-1"
* switching to temp browser "browse-browser-2"
* Searching Browse channels for channel "channel-public-join" of user "user-1"
* clicking on stored channel "channel-public-join" name for user "user-1"
* waiting for "[data-testid='join-channel']" to appear
* clicking on "[data-testid='join-channel'] button"
* waiting for "[data-testid='message-input']" to appear
* verifying stored user "user-1" channel "channel-public-join" field "name" is visible in "[data-testid='channel-list']"
