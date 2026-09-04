# DM Canvas E2E Flow
> Create a DM canvas, verify owner role, edit content, and verify persistence on reload.

## User creates new canvas from DM
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Opening DM from user "user-2"
* waiting for "[data-testid='chat-list-loading']" to disappear
* clicking on "[data-testid='channel-tab-canvas']"
* clicking on text "New Canvas"
* waiting for "[data-testid='canvas-editor']" to appear
* verifying "[data-testid='canvas-title-input']" is visible
* clicking on "[data-testid='canvas-title-input']"
* clearing text in "[data-testid='canvas-title-input']"
* typing "DM Canvas Test" in "[data-testid='canvas-title-input']"
* clicking on "[data-testid='canvas-editor']"
* waiting for "2" seconds
* storing current path as "user-1" field "canvas-dm-url"

## DM canvas creator has owner role
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-share-button']"
* verifying "Owner" is visible in "[data-testid='canvas-share-modal']"

## User adds text content to DM canvas
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-editor'] .bn-editor"
* typing "DM canvas test content" in "[data-testid='canvas-editor'] [contenteditable='true']"
* waiting for "2" seconds
* verifying "DM canvas test content" is visible in "[data-testid='canvas-editor']"

## DM canvas content persists on reload
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-editor'] .bn-editor"
* typing "DM canvas persisted content" in "[data-testid='canvas-editor'] [contenteditable='true']"
* waiting for "2" seconds
* opening stored path "user-1.canvas-dm-url"
* waiting for "[data-testid='canvas-editor']" to appear
* verifying "DM canvas persisted content" is visible in "[data-testid='canvas-editor']"
