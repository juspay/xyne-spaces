# Message Actions E2E Flow
> Verify message actions independently for easier reporting.

## Admin edits a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-edit-original" with text "Message before edit" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-edit-updated" with text "Message after edit" in channel "channel-1" for user "admin-1"
* Sending stored message "message-edit-original" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-edit-original"
* clicking on "[data-testid='hover-action-edit-message']"
* waiting for "[data-testid='message-input']" to appear
* clearing "[data-testid='message-input']"
* typing stored user "admin-1" channel "channel-1" message "message-edit-updated" in "[data-testid='message-input']"
* clicking on "[data-testid='send-message-button']"
* waiting for stored user "admin-1" channel "channel-1" message "message-edit-updated" to appear in virtuoso list

## Admin forwards a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-forward" with text "Message to forward" in channel "channel-1" for user "admin-1"
* Sending stored message "message-forward" in channel "channel-1" for user "admin-1"
* forwarding stored user "admin-1" channel "channel-1" message "message-forward" to user "user-1"
* verifying "Message forwarded" is visible in "body"

## Admin pins a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-pin" with text "Message to pin" in channel "channel-1" for user "admin-1"
* Sending stored message "message-pin" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-pin"
* clicking on "[data-testid='hover-action-pin-message']"
* waiting for zero sync to settle fast
* verifying message menu action "[data-testid='hover-action-unpin-message']" is visible for stored user "admin-1" channel "channel-1" message "message-pin"
* clicking on "[data-testid='hover-action-unpin-message']"

## Admin bookmarks a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-bookmark" with text "Message to bookmark" in channel "channel-1" for user "admin-1"
* Sending stored message "message-bookmark" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-bookmark"
* clicking on "[data-testid='hover-action-add-bookmark']"
* waiting for zero sync to settle fast
* verifying message menu action "[data-testid='hover-action-remove-bookmark']" is visible for stored user "admin-1" channel "channel-1" message "message-bookmark"
* clicking on "[data-testid='hover-action-remove-bookmark']"
* waiting for zero sync to settle fast
* verifying message menu action "[data-testid='hover-action-add-bookmark']" is visible for stored user "admin-1" channel "channel-1" message "message-bookmark"

## Admin marks a channel message unread
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-mark-unread" with text "Message to mark unread" in channel "channel-1" for user "admin-1"
* Sending stored message "message-mark-unread" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-mark-unread"
* clicking on "[data-testid='hover-action-mark-unread']"
* verifying "Marked as unread" is visible in "body"

## Admin copies a channel message link
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-copy-link" with text "Message to copy link" in channel "channel-1" for user "admin-1"
* Sending stored message "message-copy-link" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-copy-link"
* clicking on "[data-testid='hover-action-copy-link']"
* verifying clipboard contains copied channel message link for user "admin-1" channel "channel-1"
* sending clipboard text in message input
* verifying copied channel message link preview is visible for user "admin-1" channel "channel-1"

## Admin copies a channel message text
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-copy-text" with text "Message to copy text" in channel "channel-1" for user "admin-1"
* Sending stored message "message-copy-text" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-copy-text"
* clicking on "[data-testid='hover-action-copy-message']"
* verifying clipboard contains stored channel message "message-copy-text" for user "admin-1" channel "channel-1"
* sending clipboard text as stored channel message "message-copy-text-pasted" in channel "channel-1" for user "admin-1"
* waiting for stored user "admin-1" channel "channel-1" message "message-copy-text-pasted" to appear in virtuoso list

## Admin deletes a channel message
* Using browser
* Ensuring user "admin-1" is logged in
* ensuring channel "channel-1" exists in fixture for user "admin-1"
* Navigating to channel "channel-1" for user "admin-1"
* generating net-new message details "message-delete" with text "Message to delete" in channel "channel-1" for user "admin-1"
* Sending stored message "message-delete" in channel "channel-1" for user "admin-1"
* opening more actions for stored user "admin-1" channel "channel-1" message "message-delete"
* clicking on "[data-testid='hover-action-delete-message']"
* clicking on "[data-testid='confirm-delete-message']"
* waiting for zero sync to settle fast
* verifying stored user "admin-1" channel "channel-1" message "message-delete" is deleted
