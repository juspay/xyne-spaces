# Create Ticket from Chat E2E Flow
> Convert a chat message into a ticket via the send-options-menu, with and without an attachment.

## Admin creates a ticket from chat
* Setting up ticket test with user "user-2" in channel "channel-1" for admin "admin-1"
* Creating ticket "ticket-chat-1" from chat for user "admin-1"

## Admin creates a ticket from chat with an attachment
* Setting up ticket test in channel "channel-1" for admin "admin-1"
* ensuring ticket "ticket-chat-attach-1" exists in fixture for user "admin-1"
* waiting for "[data-testid='message-input']" to appear
* typing "Bug with attachment needed" in "[data-testid='message-input']"
* clicking on "[data-testid='send-options-menu']"
* clicking on text "Create a ticket"
* clicking on "[data-testid='send-message-button']"
* waiting for "[data-testid='ticket-title-input']" to appear
* typing stored user "admin-1" ticket "ticket-chat-attach-1" field "title" in "[data-testid='ticket-title-input']"
* typing stored user "admin-1" ticket "ticket-chat-attach-1" field "description" in "[data-testid='ticket-description-input']"
* attaching file to "[data-testid='ticket-attachment-input']"
* clicking on "[data-testid='ticket-submit-button']"
* waiting for "[data-testid='ticket-title-input']" to disappear
