# Thread Actions E2E Flow
> Message actions on thread replies and the thread root (TH-40..TH-61 in docs/test-plans/chat-threads.md).

## Admin edits own reply and User1 sees the edited text
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-40"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root edit reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-original" with text "Reply before edit" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-updated" with text "Reply after edit" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply-original" in channel "channel-1" for user "admin-1" in open thread
* Editing stored thread message "message-reply-original" to "message-reply-updated" in channel "channel-1" for user "admin-1" in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply-original" is not visible in "[data-testid='thread-panel']"
* switching to temp browser "user1-browser-40"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Verifying stored message "message-reply-updated" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply-original" is not visible in "[data-testid='thread-panel']"

## Admin deletes own reply and the reply count goes down
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root delete reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-keep" with text "Reply to keep" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply-delete" with text "Reply to delete" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply-keep" in channel "channel-1" for user "admin-1" in open thread
* Sending stored reply "message-reply-delete" in channel "channel-1" for user "admin-1" in open thread
* verifying "button[aria-label='View thread (2 replies)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"
* Deleting stored thread message "message-reply-delete" in channel "channel-1" for user "admin-1" in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-reply-delete" is not visible in "[data-testid='thread-panel']"
* verifying "button[aria-label='View thread (1 reply)']" is visible on stored user "admin-1" channel "channel-1" message "message-thread-root" in "[data-testid='chat-message-list']"

## User1 cannot edit or delete an admin reply
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-43"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root foreign reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Admin owned reply" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-43"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* verifying "[data-testid='hover-action-edit-message']" is not visible
* verifying "[data-testid='hover-action-delete-message']" is not visible
* pressing "Escape"

## User1 reacts to an admin reply and the admin sees the reaction
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-44"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root react reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply to react to" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-44"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread
* clicking hover action "[data-testid^='inline-quick-reaction-']" on stored user "admin-1" channel "channel-1" message "message-reply" in "[data-testid='thread-panel']"
* waiting for zero sync to settle fast
* verifying "[data-testid='message-reaction-chip']" is visible on stored user "admin-1" channel "channel-1" message "message-reply" in "[data-testid='thread-panel']"
* switching to main browser
* verifying "[data-testid='message-reaction-chip']" is visible on stored user "admin-1" channel "channel-1" message "message-reply" in "[data-testid='thread-panel']"

## Admin bookmarks a reply and removes the bookmark
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root bookmark reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply to bookmark" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* clicking on "[data-testid='hover-action-add-bookmark']"
* waiting for zero sync to settle fast
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* waiting for "[data-testid='hover-action-remove-bookmark']" to appear
* clicking on "[data-testid='hover-action-remove-bookmark']"
* waiting for zero sync to settle fast
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* waiting for "[data-testid='hover-action-add-bookmark']" to appear

## User1 marks an admin reply unread
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-47"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root unread reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply to mark unread" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* switching to temp browser "user1-browser-47"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* clicking on "[data-testid='hover-action-mark-unread']"
* verifying "Marked as unread" is visible in "body"

## Admin copies the text of a reply
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root copy reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply to copy" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Opening more actions for stored message "message-reply" in channel "channel-1" for user "admin-1" in open thread
* clicking on "[data-testid='hover-action-copy-message']"
* verifying clipboard contains stored channel message "message-reply" for user "admin-1" channel "channel-1"

## Admin edits the thread root and the channel shows the new text
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root before edit" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-thread-root-updated" with text "Thread root after edit" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply under edited root" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Editing stored thread message "message-thread-root" to "message-thread-root-updated" in channel "channel-1" for user "admin-1" in open thread
* verifying stored user "admin-1" channel "channel-1" message "message-thread-root-updated" is visible in "[data-testid='chat-message-list']"

## Admin deletes a thread root that has replies and the replies remain
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root to delete" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply that outlives root" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Deleting stored thread message "message-thread-root" in channel "channel-1" for user "admin-1" in open thread
* verifying "This message was deleted" is visible in "[data-testid='thread-panel']"
* Verifying stored message "message-reply" in channel "channel-1" for user "admin-1" is visible in open thread
