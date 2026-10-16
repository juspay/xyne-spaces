# Forward To Channel E2E Flow
> Forward a DM message into a channel and verify channel members receive it.

## User1 forwards a DM message to a channel not yet opened in this session -> channel member receives it
* Using browser
* Logging in user "admin-1" on temp browser "forward-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-forward-channel" with text "DM forwarded to channel" in dm "dm-1" for user "user-1"
* Sending stored message "message-forward-channel" in dm "dm-1" for user "user-1"
* forwarding stored user "user-1" dm "dm-1" message "message-forward-channel" to channel "channel-1"
* verifying "Message forwarded" is visible in "body"
* switching to temp browser "forward-browser-1"
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* waiting for stored user "user-1" dm "dm-1" message "message-forward-channel" to appear in virtuoso list
