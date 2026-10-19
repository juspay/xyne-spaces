# Thread Replies E2E Flow
> Open, close and reply in channel and DM threads (TH-01..TH-32 in docs/test-plans/chat-threads.md).

## Admin opens a thread from a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root to open" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Verifying stored message "message-thread-root" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "[data-testid='thread-panel'] [data-testid='message-input']" is visible

## Admin closes an open thread panel
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root to close" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Closing thread panel
* verifying "[data-testid='chat-message-list']" is visible

## Admin replies in a thread and the reply stays out of the channel list
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Thread reply" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply" is not visible in "[data-testid='chat-message-list']"

## Reply count on the root grows with each reply
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for count" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-1" with text "First counted reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-2" with text "Second counted reply" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply-1" in channel "channel-1" for user "admin-1" in open thread
* verifying "button[aria-label='View thread (1 reply)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"
* Sending stored reply "message-reply-2" in channel "channel-1" for user "admin-1" in open thread
* verifying "button[aria-label='View thread (2 replies)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"

## Admin reopens a thread from the reply count row
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root to reopen" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply before reopen" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Closing thread panel
* Opening thread from reply count on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread

## User1 receives an admin reply live in an open thread
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-13"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for live reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Live reply from admin" in channel "channel-1" for user "admin-1"
* switching to temp browser "user1-browser-13"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* switching to main browser
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-13"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread

## User1 and User2 both reply in a DM thread
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-18"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-thread-root" with text "DM thread root" in dm "dm-1" for user "user-1"
* generating net-new message details "message-reply-user1" with text "DM thread reply from user1" in dm "dm-1" for user "user-1"
* generating net-new message details "message-reply-user2" with text "DM thread reply from user2" in dm "dm-1" for user "user-2"
* Sending stored message "message-thread-root" in dm "dm-1" for user "user-1"
* Opening thread on stored message "message-thread-root" in dm "dm-1" for user "user-1"
* Sending stored reply "message-reply-user1" in dm "dm-1" for user "user-1" in open thread
* switching to temp browser "user2-browser-18"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-thread-root" to appear in virtuoso list
* Opening thread on stored message "message-thread-root" in dm "dm-1" for user "user-1"
* Verifying stored message "message-reply-user1" in dm "dm-1" for user "user-1" is visible in open thread
* Sending stored reply "message-reply-user2" in dm "dm-1" for user "user-2" in open thread
* switching to main browser
* Verifying stored message "message-reply-user2" in dm "dm-1" for user "user-2" is visible in open thread

## Replies inside a thread offer no nested thread
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root no nesting" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply without nesting" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* verifying "[data-testid='hover-action-reply-in-thread']" is not visible
* pressing "Escape"

## Admin replies with Send to channel and the copy shows in the channel
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for broadcast reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply also in channel" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-reply" in "[data-testid='thread-panel'] [data-testid='message-input']"
* clicking on "[data-testid='thread-panel'] label:has-text('Send to channel')"
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "Also sent to channel" is visible in "[data-testid='thread-panel']"
* verifying stored user "admin-1" channel "channel-1" message "message-reply" is visible in "[data-testid='chat-message-list']"
* verifying "text=replied to a thread:" is visible on stored user "admin-1" channel "channel-1" message "message-reply" in "[data-testid='chat-message-list']"

## DM thread composer offers Send as direct message
* Using browser
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-thread-root" with text "DM thread root label" in dm "dm-1" for user "user-1"
* Sending stored message "message-thread-root" in dm "dm-1" for user "user-1"
* Opening thread on stored message "message-thread-root" in dm "dm-1" for user "user-1"
* verifying "Send as direct message" is visible in "[data-testid='thread-panel']"
