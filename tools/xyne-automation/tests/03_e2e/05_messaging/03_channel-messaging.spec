# Channel Messaging E2E Flow

## Admin sends message in channel -> added user receives the message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Logging in user "user-1" on temp browser "channel-browser-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-1" with text "Hello from admin in channel" in channel "channel-1" for user "admin-1"
* Sending stored message "message-1" in channel "channel-1" for user "admin-1"
* switching to temp browser "channel-browser-1"
* ensuring channel "channel-1" exists in fixture for user "user-1"
* Navigating to channel "channel-1" for user "user-1"
* Verifying stored message "message-1" in channel "channel-1" for user "admin-1" is visible in current conversation
