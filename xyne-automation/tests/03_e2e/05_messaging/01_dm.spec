# DM Messaging E2E Flow
> Send and receive messages in the baseline DM between user-1 and user-2.

## User1 sends a message in DM and User2 receives it
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Opening DM from user "user-2"
* generating net-new message details "message-1" with text "Hello from user1" in dm "dm-1" for user "user-1"
* Sending stored message "message-1" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* Opening DM from user "user-1"
* waiting for stored user "user-1" dm "dm-1" message "message-1" to appear in virtuoso list
* Verifying stored message "message-1" in dm "dm-1" for user "user-1" is visible in current conversation
