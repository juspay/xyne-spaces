# Chat Permissions: Workspace and Session E2E Flow
> CHAT-PRM-08, 14, 15, 16. Only this spec uses user-13 (primary test workspace) and user-10,
> whose catalog entry logs them into the secondary test workspace ("Test Workspace 2", same org).
> Blocked writes are sent as the browser's own user through /api/zero/push-fallback, which runs
> the same mutators and ACL as the app; a rejection comes back as `success: false` with the error.

## CHAT-PRM-08 Attachment uploaded in another workspace cannot be attached to a message
* Using browser
* Logging in user "user-10" on temp browser "secondary-browser-8"
* Ensuring user "user-13" is logged in
* creating dm "dm-prm-08-self" via API for user "user-13" with user "user-13"
* switching to temp browser "secondary-browser-8"
* creating dm "dm-prm-08-other" via API for user "user-10" with user "user-10"
* uploading fixture file "sample-notes.txt" as attachment "attachment-other-ws" for stored user "user-10" dm "dm-prm-08-other"
* switching to main browser
* uploading fixture file "sample-notes.txt" as attachment "attachment-own" for stored user "user-13" dm "dm-prm-08-self"
* sending zero mutation "conversations.send" with args "channelId=user:user-13.dms.dm-prm-08-self.id, content=Message with my own file, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now, attachmentIds=[user:user-13.dms.dm-prm-08-self.attachments.attachment-own.id]"
* verifying zero mutation succeeded
* sending zero mutation "conversations.send" with args "channelId=user:user-13.dms.dm-prm-08-self.id, content=Message with a foreign file, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now, attachmentIds=[user:user-10.dms.dm-prm-08-other.attachments.attachment-other-ws.id]"
* verifying zero mutation was rejected with "not found in this workspace"

## CHAT-PRM-14 Cannot start a DM with a user in another workspace
* Using browser
* Logging in user "user-10" on temp browser "secondary-browser-14"
* Ensuring user "user-13" is logged in
* sending POST to "/api/users/me/dms" with args "participantIds=[user:user-10.id]"
* verifying response status is "404"

## CHAT-PRM-15 Link to another workspace's message shows no preview
> The link renders as a plain "View message" chip; a resolved preview would also show the
> target message's sender and text, which must not appear.
* Using browser
* Logging in user "user-10" on temp browser "secondary-browser-15"
* Ensuring user "user-13" is logged in
* switching to temp browser "secondary-browser-15"
* creating dm "dm-prm-15-other" via API for user "user-10" with user "user-10"
* opening stored path "user-10.dms.dm-prm-15-other.url"
* generating net-new message details "message-other-ws" with text "Other workspace secret" in dm "dm-prm-15-other" for user "user-10"
* Sending stored message "message-other-ws" in dm "dm-prm-15-other" for user "user-10"
* storing id of stored user "user-10" dm "dm-prm-15-other" message "message-other-ws" in "[data-testid='virtuoso-item-list']"
* switching to main browser
* creating dm "dm-prm-15-self" via API for user "user-13" with user "user-13"
* opening stored path "user-13.dms.dm-prm-15-self.url"
* waiting for "[data-testid='message-input']" to appear
* typing "user:user-10.dms.dm-prm-15-other.url" key by key in "[data-testid='message-input']"
* typing "#messageId=" key by key in "[data-testid='message-input']"
* typing "user:user-10.dms.dm-prm-15-other.messages.message-other-ws.id" key by key in "[data-testid='message-input']"
* waiting for "[data-testid='send-message-button']" to be enabled
* clicking on "[data-testid='send-message-button']"
* waiting for zero sync to settle
* waiting for "5" seconds
* verifying text containing "user:user-10.dms.dm-prm-15-other.messages.message-other-ws.text" is not visible in "[data-testid='virtuoso-item-list']"
* verifying text "View message" is visible in "[data-testid='virtuoso-item-list']"
* verifying text containing "user:user-10.name" is not visible in "[data-testid='virtuoso-item-list']"

## CHAT-PRM-16 Sending after the session has ended is refused and the app returns to sign-in
* Using browser
* Ensuring user "user-13" is logged in
* creating dm "dm-prm-16-self" via API for user "user-13" with user "user-13"
* sending POST to "/api/test/auth/logout" with args ""
* verifying response status is "200"
* sending zero mutation "conversations.send" with args "channelId=user:user-13.dms.dm-prm-16-self.id, content=Sent after the session ended, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying response status is "401"
* Unauthenticated user opening "/chat" should land on login
