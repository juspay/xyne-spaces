# Drafts And Sent E2E Flow
> A sent message shows on the Sent tab and unsent text shows on the Drafts tab.

## User sends one message and leaves another unsent -> Sent and Drafts tabs list them
* Using browser
* Ensuring user "user-4" is logged in
* Creating DM with user "user-4"
* generating net-new message details "message-sent" with text "Message for sent tab" in dm "dm-self" for user "user-4"
* generating net-new message details "message-draft" with text "Unsent draft" in dm "dm-self" for user "user-4"
* Sending stored message "message-sent" in dm "dm-self" for user "user-4"
* typing stored user "user-4" dm "dm-self" message "message-draft" in "[data-testid='message-input']"
* waiting for stored user "user-4" dm "dm-self" message "message-draft" to be saved as a draft
* clicking on "[data-testid='open-drafts-and-sent-button']"
* clicking on "[data-testid='drafts-sent-tab-sent']"
* waiting for "[data-testid='drafts-sent-content']" to appear
* verifying stored user "user-4" dm "dm-self" message "message-sent" is visible in "[data-testid='drafts-sent-content']"
* clicking on "[data-testid='drafts-sent-tab-drafts']"
* verifying stored user "user-4" dm "dm-self" message "message-draft" is visible in "[data-testid='drafts-sent-content']"

## User reopens a draft from the Drafts tab -> the unsent text is back in the composer
* Using browser
* Ensuring user "user-2" is logged in
* Creating DM with user "user-2"
* generating net-new message details "message-draft-first" with text "First message" in dm "dm-self" for user "user-2"
* generating net-new message details "message-draft" with text "Draft to reopen" in dm "dm-self" for user "user-2"
* Sending stored message "message-draft-first" in dm "dm-self" for user "user-2"
* typing stored user "user-2" dm "dm-self" message "message-draft" in "[data-testid='message-input']"
* waiting for stored user "user-2" dm "dm-self" message "message-draft" to be saved as a draft
* clicking on "[data-testid='open-drafts-and-sent-button']"
* waiting for "[data-testid='drafts-sent-content']" to appear
* clicking draft action "Edit draft" for stored user "user-2" dm "dm-self" message "message-draft"
* waiting for "[data-testid='message-input']" to appear
* verifying stored user "user-2" dm "dm-self" message "message-draft" is visible in "[data-testid='message-input']"

## User sends a draft from the Drafts tab -> it is posted in the DM and leaves the Drafts tab
* Using browser
* Ensuring user "user-3" is logged in
* Creating DM with user "user-3"
* generating net-new message details "message-draft-first" with text "First message" in dm "dm-self" for user "user-3"
* generating net-new message details "message-draft" with text "Draft to send" in dm "dm-self" for user "user-3"
* Sending stored message "message-draft-first" in dm "dm-self" for user "user-3"
* typing stored user "user-3" dm "dm-self" message "message-draft" in "[data-testid='message-input']"
* waiting for stored user "user-3" dm "dm-self" message "message-draft" to be saved as a draft
* clicking on "[data-testid='open-drafts-and-sent-button']"
* waiting for "[data-testid='drafts-sent-content']" to appear
* clicking draft action "Send draft" for stored user "user-3" dm "dm-self" message "message-draft"
* clicking on "[data-testid='confirm-send-draft']"
* verifying "Message sent" is visible in "body"
* waiting for stored user "user-3" dm "dm-self" message "message-draft" to appear in virtuoso list
* clicking on "[data-testid='open-drafts-and-sent-button']"
* waiting for "[data-testid='drafts-sent-content']" to appear
* verifying stored user "user-3" dm "dm-self" message "message-draft" is not visible in "[data-testid='drafts-sent-content']"

## User deletes a draft from the Drafts tab -> it is removed
* Using browser
* Ensuring user "admin-2" is logged in
* Creating DM with user "admin-2"
* generating net-new message details "message-draft-first" with text "First message" in dm "dm-self" for user "admin-2"
* generating net-new message details "message-draft" with text "Draft to delete" in dm "dm-self" for user "admin-2"
* Sending stored message "message-draft-first" in dm "dm-self" for user "admin-2"
* typing stored user "admin-2" dm "dm-self" message "message-draft" in "[data-testid='message-input']"
* waiting for stored user "admin-2" dm "dm-self" message "message-draft" to be saved as a draft
* clicking on "[data-testid='open-drafts-and-sent-button']"
* waiting for "[data-testid='drafts-sent-content']" to appear
* clicking draft action "Delete draft" for stored user "admin-2" dm "dm-self" message "message-draft"
* clicking on "[data-testid='confirm-delete-draft']"
* verifying "Draft deleted" is visible in "body"
* verifying stored user "admin-2" dm "dm-self" message "message-draft" is not visible in "[data-testid='drafts-sent-content']"
