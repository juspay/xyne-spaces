# Channel Settings E2E Flow
> The channel owner can rename a channel and edit its description from channel info.

## Owner renames a channel -> the new name shows in the channel list
* Using browser
* Ensuring user "user-1" is logged in
* Creating channel "channel-rename" for user "user-1" in project "project-1"
* clicking on "[data-testid='channel-info-trigger']"
* renaming stored user "user-1" channel "channel-rename" to a net-new name
* clicking on "[aria-label='Close channel info']"
* verifying stored user "user-1" channel "channel-rename" field "name" is visible in "[data-testid='channel-list']"

## Owner edits the channel description -> it is still shown after reopening channel info
* Using browser
* Ensuring user "user-1" is logged in
* Creating channel "channel-description" for user "user-1" in project "project-1"
* clicking on "[data-testid='channel-info-trigger']"
* setting a net-new description on stored user "user-1" channel "channel-description"
* clicking on "[aria-label='Close channel info']"
* clicking on "[data-testid='channel-info-trigger']"
* verifying stored user "user-1" channel "channel-description" field "description" is visible in "[role='dialog']"
