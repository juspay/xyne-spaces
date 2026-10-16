# Thread Multi-User E2E Flow
> Three or more users in the same thread (TH-150..TH-170 in docs/test-plans/chat-threads.md).
> Channel threads use the baseline channel-1 members: admin-1, user-1 and user-2.

## Three users reply in turn and everyone sees the same order
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-150"
* Logging in user "user-2" on temp browser "user2-browser-150"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Round robin root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-user1" with text "Round robin user1" in channel "channel-1" for user "user-1"
* generating net-new message details "message-reply-user2" with text "Round robin user2" in channel "channel-1" for user "user-2"
* generating net-new message details "message-reply-admin" with text "Round robin admin" in channel "channel-1" for user "admin-1"
* switching to temp browser "user1-browser-150"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply-user1" in channel "channel-1" for user "user-1" in open thread
* switching to temp browser "user2-browser-150"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* Verifying stored message "message-reply-user1" in channel "channel-1" for user "user-1" is visible in open thread
* Sending stored reply "message-reply-user2" in channel "channel-1" for user "user-2" in open thread
* switching to main browser
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Verifying stored message "message-reply-user2" in channel "channel-1" for user "user-2" is visible in open thread
* Sending stored reply "message-reply-admin" in channel "channel-1" for user "admin-1" in open thread
* verifying stored user "user-1" channel "channel-1" message "message-reply-user1" appears before stored user "user-2" channel "channel-1" message "message-reply-user2" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying stored user "user-2" channel "channel-1" message "message-reply-user2" appears before stored user "admin-1" channel "channel-1" message "message-reply-admin" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "button[aria-label='View thread (3 replies)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"
* switching to temp browser "user1-browser-150"
* verifying stored user "user-2" channel "channel-1" message "message-reply-user2" appears before stored user "admin-1" channel "channel-1" message "message-reply-admin" in "[data-testid='thread-panel'] [data-component='ThreadList']"

## Every open session receives each reply live
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-151"
* Logging in user "user-2" on temp browser "user2-browser-151"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Live fan-out root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-admin" with text "Live fan-out admin" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-user1" with text "Live fan-out user1" in channel "channel-1" for user "user-1"
* generating net-new message details "message-reply-user2" with text "Live fan-out user2" in channel "channel-1" for user "user-2"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* switching to temp browser "user1-browser-151"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* switching to temp browser "user2-browser-151"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* switching to main browser
* Sending stored reply "message-reply-admin" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-151"
* Verifying stored message "message-reply-admin" in channel "channel-1" for user "admin-1" is visible in open thread
* Sending stored reply "message-reply-user1" in channel "channel-1" for user "user-1" in open thread
* switching to temp browser "user2-browser-151"
* Verifying stored message "message-reply-admin" in channel "channel-1" for user "admin-1" is visible in open thread
* Verifying stored message "message-reply-user1" in channel "channel-1" for user "user-1" is visible in open thread
* Sending stored reply "message-reply-user2" in channel "channel-1" for user "user-2" in open thread
* switching to main browser
* Verifying stored message "message-reply-user1" in channel "channel-1" for user "user-1" is visible in open thread
* Verifying stored message "message-reply-user2" in channel "channel-1" for user "user-2" is visible in open thread
* switching to temp browser "user1-browser-151"
* Verifying stored message "message-reply-user2" in channel "channel-1" for user "user-2" is visible in open thread

## Reply count updates live for a user watching the channel
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-153"
* Logging in user "user-2" on temp browser "user2-browser-153"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Watched count root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-user1" with text "Watched count user1" in channel "channel-1" for user "user-1"
* generating net-new message details "message-reply-user2" with text "Watched count user2" in channel "channel-1" for user "user-2"
* switching to temp browser "user1-browser-153"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply-user1" in channel "channel-1" for user "user-1" in open thread
* switching to temp browser "user2-browser-153"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* Sending stored reply "message-reply-user2" in channel "channel-1" for user "user-2" in open thread
* switching to main browser
* verifying "button[aria-label='View thread (2 replies)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"

## Group DM members all see a thread and its replies
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-154"
* Logging in user "user-3" on temp browser "user3-browser-154"
* Ensuring user "user-1" is logged in
* generating net-new message details "message-thread-root" with text "Group DM thread root" in dm "dm-group" for user "user-1"
* generating net-new message details "message-reply-user1" with text "Group DM reply user1" in dm "dm-group" for user "user-1"
* generating net-new message details "message-reply-user2" with text "Group DM reply user2" in dm "dm-group" for user "user-2"
* Creating group DM with users "user-2" and "user-3"
* Sending stored message "message-thread-root" in dm "dm-group" for user "user-1"
* Opening thread on stored message "message-thread-root" in dm "dm-group" for user "user-1"
* Sending stored reply "message-reply-user1" in dm "dm-group" for user "user-1" in open thread
* switching to temp browser "user2-browser-154"
* Opening DM from user "user-3"
* waiting for stored user "user-1" dm "dm-group" message "message-thread-root" to appear in virtuoso list
* Opening thread on stored message "message-thread-root" in dm "dm-group" for user "user-1"
* Verifying stored message "message-reply-user1" in dm "dm-group" for user "user-1" is visible in open thread
* Sending stored reply "message-reply-user2" in dm "dm-group" for user "user-2" in open thread
* switching to temp browser "user3-browser-154"
* Opening DM from user "user-2"
* waiting for stored user "user-1" dm "dm-group" message "message-thread-root" to appear in virtuoso list
* Opening thread on stored message "message-thread-root" in dm "dm-group" for user "user-1"
* Verifying stored message "message-reply-user1" in dm "dm-group" for user "user-1" is visible in open thread
* Verifying stored message "message-reply-user2" in dm "dm-group" for user "user-2" is visible in open thread

## An edited reply updates for every viewer
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-160"
* Logging in user "user-2" on temp browser "user2-browser-160"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Multi viewer edit root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-original" with text "Multi viewer reply before edit" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-updated" with text "Multi viewer reply after edit" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply-original" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-160"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Verifying stored message "message-reply-original" in channel "channel-1" for user "admin-1" is visible in open thread
* switching to temp browser "user2-browser-160"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* Verifying stored message "message-reply-original" in channel "channel-1" for user "admin-1" is visible in open thread
* switching to main browser
* Editing stored thread message "message-reply-original" to "message-reply-updated" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-160"
* Verifying stored message "message-reply-updated" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply-original" is not visible in "[data-testid='thread-panel']"
* switching to temp browser "user2-browser-160"
* Verifying stored message "message-reply-updated" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply-original" is not visible in "[data-testid='thread-panel']"

## A deleted reply disappears for every viewer
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-161"
* Logging in user "user-2" on temp browser "user2-browser-161"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Multi viewer delete root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Multi viewer reply to delete" in channel "channel-1" for user "user-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* switching to temp browser "user2-browser-161"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* switching to temp browser "user1-browser-161"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "user-1" in open thread
* switching to main browser
* Verifying stored message "message-reply" in channel "channel-1" for user "user-1" is visible in open thread
* switching to temp browser "user2-browser-161"
* Verifying stored message "message-reply" in channel "channel-1" for user "user-1" is visible in open thread
* switching to temp browser "user1-browser-161"
* Deleting stored thread message "message-reply" in channel "channel-1" for user "user-1" in open thread
* verifying stored user "user-1" channel "channel-1" message "message-reply" is not visible in "[data-testid='thread-panel']"
* switching to main browser
* verifying stored user "user-1" channel "channel-1" message "message-reply" is not visible in "[data-testid='thread-panel']"
* switching to temp browser "user2-browser-161"
* verifying stored user "user-1" channel "channel-1" message "message-reply" is not visible in "[data-testid='thread-panel']"

## A reply notifies every other thread participant
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-170"
* Logging in user "user-2" on temp browser "user2-browser-170"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Fan-out notify root" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-user1" with text "Fan-out notify user1" in channel "channel-1" for user "user-1"
* generating net-new message details "message-reply-user2" with text "Fan-out notify user2" in channel "channel-1" for user "user-2"
* switching to temp browser "user1-browser-170"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply-user1" in channel "channel-1" for user "user-1" in open thread
* switching to temp browser "user2-browser-170"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-2"
* Sending stored reply "message-reply-user2" in channel "channel-1" for user "user-2" in open thread
* switching to main browser
* navigating via sidebar to "activity"
* verifying stored user "user-2" channel "channel-1" message "message-reply-user2" is visible in "body"
* switching to temp browser "user1-browser-170"
* navigating via sidebar to "activity"
* verifying stored user "user-2" channel "channel-1" message "message-reply-user2" is visible in "body"
