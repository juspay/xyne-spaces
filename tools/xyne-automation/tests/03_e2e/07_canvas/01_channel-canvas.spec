# Channel Canvas E2E Flow
> Create a channel canvas, verify owner role, edit content, and verify persistence on reload.

## User creates new canvas from channel
* Using browser
* Ensuring user "user-1" is logged in
* Navigating to channel "channel-1" for user "user-1"
* waiting for "[data-testid='chat-list-loading']" to disappear
* clicking on "[data-testid='channel-tab-canvas']"
* clicking on text "New Canvas"
* waiting for "[data-testid='canvas-editor']" to appear
* verifying "[data-testid='canvas-title-input']" is visible
* clicking on "[data-testid='canvas-title-input']"
* clearing text in "[data-testid='canvas-title-input']"
* typing "Channel Canvas Test" in "[data-testid='canvas-title-input']"
* clicking on "[data-testid='canvas-editor']"
* waiting for "2" seconds
* storing current path as "user-1" field "canvas-url"

## Channel canvas creator has owner role
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* verifying "Owner" is visible in "[data-testid='canvas-share-modal']"

## User adds text content to channel canvas
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-editor'] .bn-editor"
* typing "Test canvas content" in "[data-testid='canvas-editor'] [contenteditable='true']"
* waiting for "2" seconds
* verifying "Test canvas content" is visible in "[data-testid='canvas-editor']"

## Channel canvas content persists on reload
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-editor'] .bn-editor"
* typing "Persisted content test" in "[data-testid='canvas-editor'] [contenteditable='true']"
* waiting for "2" seconds
* opening stored path "user-1.canvas-url"
* waiting for "[data-testid='canvas-editor']" to appear
* verifying "Persisted content test" is visible in "[data-testid='canvas-editor']"
