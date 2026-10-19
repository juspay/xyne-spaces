# Thread Mentions E2E Flow
> Tag a person and a user group in a thread reply (TH-70 in docs/test-plans/chat-threads.md).
> The baseline user group (admin-1 userGroups group-1) has user-1 and user-2 as members.
> Rendered mentions show the name only; the leading "@" comes from CSS.

## Admin tags User2 in a thread reply and User2 is notified
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for a person tag" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-mention" with text "Tagging a teammate in a thread" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-mention" in "[data-testid='thread-panel'] [data-testid='message-input']"
* typing " @user:user-2.name" key by key in "[data-testid='thread-panel'] [data-testid='message-input']"
* clicking on stored user "user-2" field "name" in "[data-testid='user-search-results']"
* verifying "[data-testid='thread-panel'] [data-testid='message-input'] [data-mention-type='user']" is visible
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-mention" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "[data-mention-type='user']" is visible on stored user "admin-1" channel "channel-1" message "message-mention" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "user:user-2.name" is visible in "[data-testid='thread-panel'] [data-component='ThreadList']"
* switching to temp browser "user2-browser-1"
* navigating via sidebar to "activity"
* verifying stored user "admin-1" channel "channel-1" message "message-mention" is visible in "body"

## Admin tags a user group in a thread reply and every member is notified
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-1"
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for a group tag" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-group-mention" with text "Tagging the whole group in a thread" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-group-mention" in "[data-testid='thread-panel'] [data-testid='message-input']"
* typing " @user:admin-1.userGroups.group-1.alias" key by key in "[data-testid='thread-panel'] [data-testid='message-input']"
* clicking on text "@user:admin-1.userGroups.group-1.alias" in "[data-testid='user-search-results']"
* verifying "[data-testid='thread-panel'] [data-testid='message-input'] [data-mention-type='group']" is visible
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-group-mention" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "[data-mention-type='group']" is visible on stored user "admin-1" channel "channel-1" message "message-group-mention" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "user:admin-1.userGroups.group-1.alias" is visible in "[data-testid='thread-panel'] [data-component='ThreadList']"
* switching to temp browser "user1-browser-1"
* navigating via sidebar to "activity"
* verifying stored user "admin-1" channel "channel-1" message "message-group-mention" is visible in "body"
* switching to temp browser "user2-browser-1"
* navigating via sidebar to "activity"
* verifying stored user "admin-1" channel "channel-1" message "message-group-mention" is visible in "body"
