# DM Two-User Conversation E2E Flow
> Two users talk in the baseline DM; every change one user makes must reach the other user live.

## User1 and User2 exchange messages in both directions
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-ping" with text "Ping from user1" in dm "dm-1" for user "user-1"
* generating net-new message details "message-pong" with text "Pong from user2" in dm "dm-1" for user "user-2"
* Sending stored message "message-ping" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-ping" to appear in virtuoso list
* Sending stored message "message-pong" in dm "dm-1" for user "user-2"
* switching to main browser
* waiting for stored user "user-2" dm "dm-1" message "message-pong" to appear in virtuoso list
* Verifying stored message "message-pong" in dm "dm-1" for user "user-2" is visible in current conversation

## User1 sends several DM messages back to back and User2 receives all of them
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-burst-1" with text "Burst one from user1" in dm "dm-1" for user "user-1"
* generating net-new message details "message-burst-2" with text "Burst two from user1" in dm "dm-1" for user "user-1"
* generating net-new message details "message-burst-3" with text "Burst three from user1" in dm "dm-1" for user "user-1"
* Sending stored message "message-burst-1" in dm "dm-1" for user "user-1"
* Sending stored message "message-burst-2" in dm "dm-1" for user "user-1"
* Sending stored message "message-burst-3" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-burst-3" to appear in virtuoso list
* Verifying stored message "message-burst-1" in dm "dm-1" for user "user-1" is visible in current conversation
* Verifying stored message "message-burst-2" in dm "dm-1" for user "user-1" is visible in current conversation
* Verifying stored message "message-burst-3" in dm "dm-1" for user "user-1" is visible in current conversation

## User1 edits a DM message and User2 sees the edited text
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-edit-original" with text "DM before edit" in dm "dm-1" for user "user-1"
* generating net-new message details "message-edit-updated" with text "DM after edit" in dm "dm-1" for user "user-1"
* Sending stored message "message-edit-original" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-edit-original" to appear in virtuoso list
* switching to main browser
* Opening more actions for stored message "message-edit-original" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-edit-message']"
* waiting for "[data-testid='message-input']" to appear
* clearing "[data-testid='message-input']"
* typing stored user "user-1" dm "dm-1" message "message-edit-updated" in "[data-testid='message-input']"
* clicking on "[data-testid='send-message-button']"
* waiting for stored user "user-1" dm "dm-1" message "message-edit-updated" to appear in virtuoso list
* switching to temp browser "user2-browser-1"
* waiting for stored user "user-1" dm "dm-1" message "message-edit-updated" to appear in virtuoso list
* verifying stored user "user-1" dm "dm-1" message "message-edit-original" is not visible in "[data-testid='chat-message-list']"

## User1 deletes a DM message and it disappears for User2
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-delete" with text "DM to delete" in dm "dm-1" for user "user-1"
* Sending stored message "message-delete" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-delete" to appear in virtuoso list
* switching to main browser
* Opening more actions for stored message "message-delete" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-delete-message']"
* clicking on "[data-testid='confirm-delete-message']"
* waiting for zero sync to settle fast
* verifying stored user "user-1" dm "dm-1" message "message-delete" is not visible in "[data-testid='chat-message-list']"
* switching to temp browser "user2-browser-1"
* verifying stored user "user-1" dm "dm-1" message "message-delete" is not visible in "[data-testid='chat-message-list']"

## User2 reacts to a DM message and User1 sees the reaction
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-react" with text "DM to react to" in dm "dm-1" for user "user-1"
* Sending stored message "message-react" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-react" to appear in virtuoso list
* clicking hover action "[data-testid^='inline-quick-reaction-']" on stored user "user-1" dm "dm-1" message "message-react" in "[data-testid='chat-message-list']"
* waiting for zero sync to settle fast
* verifying "[data-testid='message-reaction-chip']" is visible on stored user "user-1" dm "dm-1" message "message-react" in "[data-testid='chat-message-list']"
* switching to main browser
* verifying "[data-testid='message-reaction-chip']" is visible on stored user "user-1" dm "dm-1" message "message-react" in "[data-testid='chat-message-list']"

## User1 forwards a DM message and the target user receives it
* Using browser
* Logging in user "admin-1" on temp browser "admin-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-forward" with text "DM to forward" in dm "dm-1" for user "user-1"
* Sending stored message "message-forward" in dm "dm-1" for user "user-1"
* forwarding stored user "user-1" dm "dm-1" message "message-forward" to user "admin-1"
* verifying "Message forwarded" is visible in "body"
* switching to temp browser "admin-browser-1"
* Opening DM from user "user-1"
* waiting for stored user "user-1" dm "dm-1" message "message-forward" to appear in virtuoso list

## User1 pins a DM message and User2 sees it pinned
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-pin" with text "DM to pin" in dm "dm-1" for user "user-1"
* Sending stored message "message-pin" in dm "dm-1" for user "user-1"
* Opening more actions for stored message "message-pin" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-pin-message']"
* waiting for zero sync to settle fast
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-pin" to appear in virtuoso list
* Opening more actions for stored message "message-pin" in dm "dm-1" for user "user-1"
* waiting for "[data-testid='hover-action-unpin-message']" to appear
* clicking on "[data-testid='hover-action-unpin-message']"

## User1 bookmarks a DM message and the bookmark stays private to User1
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-bookmark" with text "DM to bookmark" in dm "dm-1" for user "user-1"
* Sending stored message "message-bookmark" in dm "dm-1" for user "user-1"
* Opening more actions for stored message "message-bookmark" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-add-bookmark']"
* waiting for zero sync to settle fast
* Opening more actions for stored message "message-bookmark" in dm "dm-1" for user "user-1"
* waiting for "[data-testid='hover-action-remove-bookmark']" to appear
* pressing "Escape"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-bookmark" to appear in virtuoso list
* Opening more actions for stored message "message-bookmark" in dm "dm-1" for user "user-1"
* waiting for "[data-testid='hover-action-add-bookmark']" to appear
* pressing "Escape"
* switching to main browser
* Opening more actions for stored message "message-bookmark" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-remove-bookmark']"

## User2 marks a received DM message unread
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-mark-unread" with text "DM to mark unread" in dm "dm-1" for user "user-1"
* Sending stored message "message-mark-unread" in dm "dm-1" for user "user-1"
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-mark-unread" to appear in virtuoso list
* Opening more actions for stored message "message-mark-unread" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-mark-unread']"
* verifying "Marked as unread" is visible in "body"

## User1 shares a copied DM message link and User2 sees the link preview
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-copy-link" with text "DM to copy link" in dm "dm-1" for user "user-1"
* Sending stored message "message-copy-link" in dm "dm-1" for user "user-1"
* Opening more actions for stored message "message-copy-link" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-copy-link']"
* verifying clipboard contains copied dm message link for user "user-1" dm "dm-1"
* sending clipboard text in message input
* verifying copied message link preview is visible in current conversation
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* verifying copied message link preview is visible in current conversation

## User1 pastes copied DM text as a new message and User2 receives it
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* opening baseline DM for user "user-1"
* generating net-new message details "message-copy-text" with text "DM to copy text" in dm "dm-1" for user "user-1"
* Sending stored message "message-copy-text" in dm "dm-1" for user "user-1"
* Opening more actions for stored message "message-copy-text" in dm "dm-1" for user "user-1"
* clicking on "[data-testid='hover-action-copy-message']"
* verifying clipboard contains stored dm message "message-copy-text" for user "user-1" dm "dm-1"
* sending clipboard text as stored dm message "message-copy-text-pasted" in dm "dm-1" for user "user-1"
* waiting for stored user "user-1" dm "dm-1" message "message-copy-text-pasted" to appear in virtuoso list
* switching to temp browser "user2-browser-1"
* opening baseline DM for user "user-2"
* waiting for stored user "user-1" dm "dm-1" message "message-copy-text-pasted" to appear in virtuoso list
