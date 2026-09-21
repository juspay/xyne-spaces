# InputBox Editing and Formatting
> Verify keyboard shortcuts, list creation/navigation, and link functionality.

## All text formatting shortcuts work
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* typing "Bold" in "[data-testid='message-input']"
* selecting all text in editor
* pressing bold keyboard shortcut
* verifying bold formatting is applied in editor
* clicking on "[data-testid='message-input']"
* typing " Italic" in "[data-testid='message-input']"
* selecting all text in editor
* pressing italic keyboard shortcut
* verifying italic formatting is applied in editor
* clicking on "[data-testid='message-input']"
* typing " Strike" in "[data-testid='message-input']"
* selecting all text in editor
* pressing strikethrough keyboard shortcut
* verifying strikethrough formatting is applied in editor
* clicking on "[data-testid='message-input']"
* typing " Underline" in "[data-testid='message-input']"
* selecting all text in editor
* pressing underline keyboard shortcut
* verifying underline formatting is applied in editor
* clicking on "[data-testid='message-input']"
* typing " code" in "[data-testid='message-input']"
* selecting all text in editor
* pressing inline code keyboard shortcut
* verifying inline code formatting is applied in editor

## List creation and navigation work
tags: quarantine
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* appending text "- First item" in "[data-testid='message-input']"
* pressing Enter in inputbox
* pressing Tab in inputbox
* appending text "Nested item" in "[data-testid='message-input']"
* verifying nested list item exists
* pressing Backspace at start of list item
* verifying list item was outdented
* pressing End in inputbox
* exiting current list via double Enter
* appending text "Normal text" in "[data-testid='message-input']"
* verifying cursor is outside list
* pressing Shift+Enter in inputbox
* appending text "Second line" in "[data-testid='message-input']"
* verifying inputbox contains multiple lines
* pressing Cmd+Enter in inputbox
* waiting for "2" seconds
* verifying message was sent to conversation

## List depth is enforced at 5 levels
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* creating nested list with "5" levels
* pressing Tab in inputbox
* verifying list depth does not exceed "5" levels

## Link operations work
* Using browser
* Ensuring user "user-1" is logged in
* Opening baseline DM for user "user-1"
* clicking on "[data-testid='message-input']"
* typing "Click here" in "[data-testid='message-input']"
* selecting all text in editor
* clicking link toolbar button
* typing "example.com" in link url input
* clicking apply link button
* verifying link is created with correct url
* verifying link url contains "https://example.com"
* selecting all text in editor
* clicking link toolbar button
* typing "updated.com" in link url input
* clicking update link button
* verifying link url was updated
* clicking on link in editor
* clicking link toolbar button
* clicking remove link button
* verifying link was removed and text remains
