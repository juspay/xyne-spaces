# Thread Notifications and Threads Page E2E Flow
> Reply activity and the Threads page (TH-81, TH-90..TH-92 in docs/test-plans/chat-threads.md).

## Admin is notified when User1 replies to the admin's message
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-81"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root notify author" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "User1 reply notifies admin" in channel "channel-1" for user "user-1"
* switching to temp browser "user1-browser-81"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "user-1" in open thread
* switching to main browser
* navigating via sidebar to "activity"
* verifying stored user "user-1" channel "channel-1" message "message-reply" is visible in "body"

## A followed thread with a reply shows on both users' Threads page
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-91"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root threads page" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply listed on threads page" in channel "channel-1" for user "user-1"
* switching to temp browser "user1-browser-91"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "user-1" in open thread
* Opening threads page sorted by most recent
* verifying stored user "user-1" channel "channel-1" message "message-reply" is visible in "body"
* switching to main browser
* Opening threads page sorted by most recent
* verifying stored user "user-1" channel "channel-1" message "message-reply" is visible in "body"

## A message without replies is not listed on the Threads page
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-root-unreplied" with text "Root without replies" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-root-replied" with text "Root with a reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-reply" with text "Reply that lists the thread" in channel "channel-1" for user "admin-1"
* Sending stored message "message-root-replied" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-root-replied" in channel "channel-1" for user "admin-1"
* Sending stored reply "message-reply" in channel "channel-1" for user "admin-1" in open thread
* Opening threads page sorted by most recent
* verifying stored user "admin-1" channel "channel-1" message "message-reply" is visible in "body"
* verifying stored user "admin-1" channel "channel-1" message "message-root-unreplied" is not visible in "body"
