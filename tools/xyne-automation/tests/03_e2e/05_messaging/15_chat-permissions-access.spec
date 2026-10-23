# Chat Permissions: Channel Access E2E Flow
> CHAT-PRM-01, 02, 03, 10, 11, 18. Only this spec uses user-6 (channel owner), user-7 (member)
> and user-8 (outsider), so it is safe beside every other spec.
> Blocked writes are sent as the browser's own user through /api/zero/push-fallback, which runs
> the same mutators and ACL as the app; a rejection comes back as `success: false` with the error.

## CHAT-PRM-01 Non-member cannot post in a private channel
* Using browser
* Logging in user "user-8" on temp browser "outsider-browser-1"
* Ensuring user "user-6" is logged in
* Creating channel "channel-prm-01" for user "user-6" in project "project-1"
* switching to temp browser "outsider-browser-1"
* sending zero mutation "conversations.send" with args "channelId=user:user-6.channels.channel-prm-01.id, content=Outsider post, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying zero mutation was rejected with "participant"

## CHAT-PRM-02 Non-member cannot read a private channel
* Using browser
* Logging in user "user-8" on temp browser "outsider-browser-2"
* Ensuring user "user-6" is logged in
* Creating channel "channel-prm-02" for user "user-6" in project "project-1"
* generating net-new message details "message-secret" with text "Private channel secret" in channel "channel-prm-02" for user "user-6"
* Sending stored message "message-secret" in channel "channel-prm-02" for user "user-6"
* switching to temp browser "outsider-browser-2"
* opening stored path "user-6.channels.channel-prm-02.url"
* waiting for network to be idle
* waiting for zero sync to settle
* verifying stored user "user-6" channel "channel-prm-02" message "message-secret" is not visible in "body"
* verifying "[data-testid='join-channel']" is not visible

## CHAT-PRM-03 Member cannot post in an archived channel
* Using browser
* Logging in user "user-7" on temp browser "member-browser-3"
* Ensuring user "user-6" is logged in
* Creating channel "channel-prm-03" for user "user-6" in project "project-1"
* Adding user "user-7" to the open channel
* switching to temp browser "member-browser-3"
* sending zero mutation "conversations.send" with args "channelId=user:user-6.channels.channel-prm-03.id, content=Member post before archive, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying zero mutation succeeded
* switching to main browser
* sending zero mutation "channel.archiveChannel" with args "channelId=user:user-6.channels.channel-prm-03.id"
* verifying zero mutation succeeded
* switching to temp browser "member-browser-3"
* opening stored path "user-6.channels.channel-prm-03.url"
* waiting for "[data-testid='archived-channel-banner']" to appear
* verifying "[data-testid='archived-channel-banner']" contains text "an archived channel"
* verifying "[data-testid='message-input']" is not visible
* sending zero mutation "conversations.send" with args "channelId=user:user-6.channels.channel-prm-03.id, content=Member post after archive, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying zero mutation was rejected with "archived channel"

## CHAT-PRM-10 Member removed from a public channel while it is open loses the composer
* Using browser
* Logging in user "user-7" on temp browser "member-browser-10"
* Ensuring user "user-6" is logged in
* Creating public channel "channel-prm-10" for user "user-6" in project "project-1"
* Adding user "user-7" to the open channel
* switching to temp browser "member-browser-10"
* opening stored path "user-6.channels.channel-prm-10.url"
* waiting for "[data-testid='message-input']" to appear
* switching to main browser
* sending zero mutation "channel.removeParticipant" with args "targetUserId=user:user-7.id, channelId=user:user-6.channels.channel-prm-10.id, updatedAt=$now"
* verifying zero mutation succeeded
* switching to temp browser "member-browser-10"
* waiting for "[data-testid='join-channel']" to appear
* verifying "[data-testid='message-input']" is not visible

## CHAT-PRM-11 Member cannot post in a private channel after leaving it
* Using browser
* Logging in user "user-7" on temp browser "member-browser-11"
* Ensuring user "user-6" is logged in
* Creating channel "channel-prm-11" for user "user-6" in project "project-1"
* Adding user "user-7" to the open channel
* switching to temp browser "member-browser-11"
* sending zero mutation "conversations.send" with args "channelId=user:user-6.channels.channel-prm-11.id, content=Member post before leaving, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying zero mutation succeeded
* sending zero mutation "channel.leaveChannel" with args "channelId=user:user-6.channels.channel-prm-11.id, updatedAt=$now"
* verifying zero mutation succeeded
* sending zero mutation "conversations.send" with args "channelId=user:user-6.channels.channel-prm-11.id, content=Member post after leaving, type=USER, conversationId=$uuid, messageId=$uuid, timestamp=$now"
* verifying zero mutation was rejected with "participant"

## CHAT-PRM-18 Nobody can remove the channel creator, and no one can remove themselves
* Using browser
* Logging in user "user-7" on temp browser "member-browser-18"
* Ensuring user "user-6" is logged in
* Creating channel "channel-prm-18" for user "user-6" in project "project-1"
* Adding user "user-7" to the open channel
* clicking on "[data-testid='channel-info-trigger']"
* clicking on "[data-testid='channel-info-members-tab']"
* verifying "[data-testid^='channel-member-actions']" is visible in "[data-testid^='channel-member-']" for stored user "user-7"
* verifying "[data-testid^='channel-member-actions']" is not visible in "[data-testid^='channel-member-']" for stored user "user-6"
* sending zero mutation "channel.removeParticipant" with args "targetUserId=user:user-6.id, channelId=user:user-6.channels.channel-prm-18.id, updatedAt=$now"
* verifying zero mutation was rejected with "Cannot remove yourself from the channel"
* sending zero mutation "channel.updateParticipantRole" with args "channelId=user:user-6.channels.channel-prm-18.id, targetUserId=user:user-7.id, newRole=ADMIN, timestamp=$now, conversationId=$uuid, messageId=$uuid, conversationParticipantId=$uuid"
* verifying zero mutation succeeded
* switching to temp browser "member-browser-18"
* sending zero mutation "channel.removeParticipant" with args "targetUserId=user:user-6.id, channelId=user:user-6.channels.channel-prm-18.id, updatedAt=$now"
* verifying zero mutation was rejected with "Cannot remove the channel creator"
