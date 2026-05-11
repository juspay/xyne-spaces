# Group Chat Creation and Messaging E2E Flow
> Create a group DM with multiple users, send a message, verify creator sees participants in dm-list and both recipients receive the message.

## User creates a group DM, sends a message, and both members receive it
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Logging in user "user-3" on temp browser "user3-browser-1"
* Ensuring user "user-1" is logged in
* generating net-new message details "message-group" with text "Hello group from creator" in dm "dm-group" for user "user-1"
* Creating group DM with users "user-2" and "user-3"
* Sending stored message "message-group" in dm "dm-group" for user "user-1"
* verifying stored user "user-2" field "name" is visible in "[data-testid='dm-list']"
* verifying stored user "user-3" field "name" is visible in "[data-testid='dm-list']"
* switching to temp browser "user2-browser-1"
* Opening DM from user "user-3"
* waiting for stored user "user-1" dm "dm-group" message "message-group" to appear in virtuoso list
* Verifying stored message "message-group" in dm "dm-group" for user "user-1" is visible in current conversation
* switching to temp browser "user3-browser-1"
* Opening DM from user "user-2"
* waiting for stored user "user-1" dm "dm-group" message "message-group" to appear in virtuoso list
* Verifying stored message "message-group" in dm "dm-group" for user "user-1" is visible in current conversation
