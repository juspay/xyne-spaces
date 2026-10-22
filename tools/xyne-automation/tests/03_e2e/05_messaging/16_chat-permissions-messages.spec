# Chat Permissions: Messages and Attachments E2E Flow
> CHAT-PRM-04, 05, 06, 07, 09, 12, 13, 17. Only this spec uses user-9 (channel owner),
> user-11 (member), user-12 (outsider) and admin-3 (workspace admin).
> Blocked writes are sent as the browser's own user through /api/zero/push-fallback, which runs
> the same mutators and ACL as the app; a rejection comes back as `success: false` with the error.

## CHAT-PRM-04 Member cannot edit someone else's message
* Using browser
* Logging in user "user-11" on temp browser "member-browser-4"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-04" for user "user-9" in project "project-1"
* Adding user "user-11" to the open channel
* generating net-new message details "message-owner" with text "Owner message to keep" in channel "channel-prm-04" for user "user-9"
* Sending stored message "message-owner" in channel "channel-prm-04" for user "user-9"
* storing id of stored user "user-9" channel "channel-prm-04" message "message-owner" in "[data-testid='virtuoso-item-list']"
* switching to temp browser "member-browser-4"
* opening stored path "user-9.channels.channel-prm-04.url"
* Verifying stored message "message-owner" in channel "channel-prm-04" for user "user-9" is visible in current conversation
* clicking hover action "[data-testid='hover-action-more']" on stored user "user-9" channel "channel-prm-04" message "message-owner" in "[data-testid='chat-message-list']"
* waiting for "[data-testid='hover-action-copy-message']" to appear
* verifying "[data-testid='hover-action-edit-message']" is not visible
* pressing "Escape"
* sending zero mutation "messages.update" with args "messageId=user:user-9.channels.channel-prm-04.messages.message-owner.id, content=Edited by someone else"
* verifying zero mutation was rejected with "Only the sender can edit the messages"

## CHAT-PRM-05 Member cannot delete someone else's message
* Using browser
* Logging in user "user-11" on temp browser "member-browser-5"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-05" for user "user-9" in project "project-1"
* Adding user "user-11" to the open channel
* generating net-new message details "message-owner" with text "Owner message to protect" in channel "channel-prm-05" for user "user-9"
* Sending stored message "message-owner" in channel "channel-prm-05" for user "user-9"
* storing id of stored user "user-9" channel "channel-prm-05" message "message-owner" in "[data-testid='virtuoso-item-list']"
* switching to temp browser "member-browser-5"
* opening stored path "user-9.channels.channel-prm-05.url"
* Verifying stored message "message-owner" in channel "channel-prm-05" for user "user-9" is visible in current conversation
* clicking hover action "[data-testid='hover-action-more']" on stored user "user-9" channel "channel-prm-05" message "message-owner" in "[data-testid='chat-message-list']"
* waiting for "[data-testid='hover-action-copy-message']" to appear
* verifying "[data-testid='hover-action-delete-message']" is not visible
* pressing "Escape"
* sending zero mutation "messages.delete" with args "messageId=user:user-9.channels.channel-prm-05.messages.message-owner.id"
* verifying zero mutation was rejected with "Only sender of message can delete it"

## CHAT-PRM-06 Member cannot delete someone else's attachment
* Using browser
* Logging in user "user-11" on temp browser "member-browser-6"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-06" for user "user-9" in project "project-1"
* Adding user "user-11" to the open channel
* uploading fixture file "sample-notes.txt" as attachment "attachment-notes" for stored user "user-9" channel "channel-prm-06"
* generating net-new message details "message-with-file" with text "Owner message with a file" in channel "channel-prm-06" for user "user-9"
* sending zero mutation "conversations.send" with args "channelId=user:user-9.channels.channel-prm-06.id, content=user:user-9.channels.channel-prm-06.messages.message-with-file.text, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now, attachmentIds=[user:user-9.channels.channel-prm-06.attachments.attachment-notes.id]"
* verifying zero mutation succeeded
* switching to temp browser "member-browser-6"
* opening stored path "user-9.channels.channel-prm-06.url"
* Verifying stored message "message-with-file" in channel "channel-prm-06" for user "user-9" is visible in current conversation
* verifying "sample-notes.txt" is visible in "[data-testid='virtuoso-item-list']"
* verifying "button[aria-label='Delete sample-notes.txt']" is not visible
* sending zero mutation "messageAttachment.delete" with args "attachmentId=user:user-9.channels.channel-prm-06.attachments.attachment-notes.id"
* verifying zero mutation was rejected with "Only sender of attachment can delete it"

## CHAT-PRM-07 Member cannot claim another user's attachment as their own upload
* Using browser
* Logging in user "user-11" on temp browser "member-browser-7"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-07" for user "user-9" in project "project-1"
* Adding user "user-11" to the open channel
* uploading fixture file "sample-notes.txt" as attachment "attachment-owner" for stored user "user-9" channel "channel-prm-07"
* switching to temp browser "member-browser-7"
* uploading fixture file "sample-notes.txt" for stored user "user-9" channel "channel-prm-07" with attachment id "user:user-9.channels.channel-prm-07.attachments.attachment-owner.id"
* verifying response status is "403"

## CHAT-PRM-09 Workspace admin cannot delete a member's message (no moderation today)
* Using browser
* Logging in user "admin-3" on temp browser "admin-browser-9"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-09" for user "user-9" in project "project-1"
* Adding user "admin-3" to the open channel
* generating net-new message details "message-member" with text "Member message an admin sees" in channel "channel-prm-09" for user "user-9"
* Sending stored message "message-member" in channel "channel-prm-09" for user "user-9"
* storing id of stored user "user-9" channel "channel-prm-09" message "message-member" in "[data-testid='virtuoso-item-list']"
* switching to temp browser "admin-browser-9"
* opening stored path "user-9.channels.channel-prm-09.url"
* Verifying stored message "message-member" in channel "channel-prm-09" for user "user-9" is visible in current conversation
* clicking hover action "[data-testid='hover-action-more']" on stored user "user-9" channel "channel-prm-09" message "message-member" in "[data-testid='chat-message-list']"
* waiting for "[data-testid='hover-action-copy-message']" to appear
* verifying "[data-testid='hover-action-delete-message']" is not visible
* pressing "Escape"
* sending zero mutation "messages.delete" with args "messageId=user:user-9.channels.channel-prm-09.messages.message-member.id"
* verifying zero mutation was rejected with "Only sender of message can delete it"

## CHAT-PRM-12 Outsider cannot forward a message from a channel they cannot see
* Using browser
* Logging in user "user-12" on temp browser "outsider-browser-12"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-12" for user "user-9" in project "project-1"
* generating net-new message details "message-private" with text "Private message not to forward" in channel "channel-prm-12" for user "user-9"
* Sending stored message "message-private" in channel "channel-prm-12" for user "user-9"
* storing id of stored user "user-9" channel "channel-prm-12" message "message-private" in "[data-testid='virtuoso-item-list']"
* switching to temp browser "outsider-browser-12"
* creating dm "dm-prm-12-self" via API for user "user-12" with user "user-12"
* sending zero mutation "conversations.forwardMessage" with args "targetChannelId=user:user-12.dms.dm-prm-12-self.id, originalMessageId=user:user-9.channels.channel-prm-12.messages.message-private.id, conversationId=$uuid, messageId=$uuid, timestamp=$now, conversationParticipantId=$uuid"
* verifying zero mutation was rejected with "origin channel"

## CHAT-PRM-13 Outsider cannot react to a message they cannot see
* Using browser
* Logging in user "user-12" on temp browser "outsider-browser-13"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-13" for user "user-9" in project "project-1"
* generating net-new message details "message-private" with text "Private message not to react to" in channel "channel-prm-13" for user "user-9"
* Sending stored message "message-private" in channel "channel-prm-13" for user "user-9"
* storing id of stored user "user-9" channel "channel-prm-13" message "message-private" in "[data-testid='virtuoso-item-list']"
* switching to temp browser "outsider-browser-13"
* sending zero mutation "messages.react" with args "messageId=user:user-9.channels.channel-prm-13.messages.message-private.id, emojiName=thumbsup, action=add, timestamp=$now"
* verifying zero mutation was rejected with "Message not available|Only member of the channel can react"

## CHAT-PRM-17 Notice about mentioning a non-member is visible only to the sender
* Using browser
* Logging in user "user-12" on temp browser "outsider-browser-17"
* Logging in user "user-11" on temp browser "member-browser-17"
* Ensuring user "user-9" is logged in
* Creating channel "channel-prm-17" for user "user-9" in project "project-1"
* Adding user "user-11" to the open channel
* generating net-new message details "message-mention" with text "Looping in an outsider" in channel "channel-prm-17" for user "user-9"
* typing stored user "user-9" channel "channel-prm-17" message "message-mention" in "[data-testid='message-input']"
* typing " @user:user-12.name" key by key in "[data-testid='message-input']"
* clicking on stored user "user-12" field "name" in "[data-testid='user-search-results']"
* clicking on "[data-testid='send-message-button']"
* waiting for stored user "user-9" channel "channel-prm-17" message "message-mention" to appear in "[data-testid='virtuoso-item-list']"
* waiting for text "but they are not in this channel" to appear in "[data-testid='virtuoso-item-list']"
* switching to temp browser "member-browser-17"
* opening stored path "user-9.channels.channel-prm-17.url"
* Verifying stored message "message-mention" in channel "channel-prm-17" for user "user-9" is visible in current conversation
* verifying text containing "but they are not in this channel" is not visible in "[data-testid='virtuoso-item-list']"
