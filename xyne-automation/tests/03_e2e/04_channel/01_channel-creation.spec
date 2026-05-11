# Channel Creation E2E Flow
> Users can create channels and see them in their channel list

## User creates a channel and sees it in channel list
* Using browser
* Ensuring user "user-1" is logged in
* Creating channel "channel-user-1" for user "user-1" in project "project-1"
* verifying stored user "user-1" channel "channel-user-1" field "name" is visible in "[data-testid='channel-list']"
* waiting for "[data-testid='chat-list-loading']" to disappear
