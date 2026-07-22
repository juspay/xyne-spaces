# InputBox Content Insertion
> Verify mentions (@user, #channel) and emoji functionality.

## Mentions work for users and channels
tags: quarantine
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* appending text "@" in "[data-testid='message-input']"
* verifying mention selector is visible
* waiting for mention selector to appear
* appending text "user" in "[data-testid='message-input']"
* selecting first mention result
* verifying user mention is inserted in editor
* appending text "#" in "[data-testid='message-input']"
* verifying channel mention selector is visible
* waiting for channel selector to appear
* appending text "baseline" in "[data-testid='message-input']"
* selecting first channel result
* verifying channel mention is inserted in editor

## Emoji insertion works via picker and shortcuts
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* clicking emoji picker button
* verifying emoji picker is visible
* selecting emoji from picker
* verifying emoji is inserted in editor
* appending text ":smile:" in "[data-testid='message-input']"
* verifying emoji appears in editor
* appending text ":) " in "[data-testid='message-input']"
* verifying smiley emoji appears in editor
