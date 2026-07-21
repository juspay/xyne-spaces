# Channel Canvas Sharing with Users
> Share canvas with other users for collaboration

## Channel Owner opens share modal
* Using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* verifying "Who has access" is visible in "[data-testid='canvas-share-modal']"
* verifying "General access" is visible in "[data-testid='canvas-share-modal']"
* verifying "Owner" is visible in "[data-testid='canvas-share-modal']"
* verifying "[data-testid='canvas-user-search-input']" is visible

## Channel Owner can copy shareable link
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* clicking on "[data-testid='canvas-copy-link-button']"
* verifying "[data-testid='canvas-copy-link-button']" is visible

## Channel Owner adds user as Viewer
* using browser
* Logging in user "user-4" on temp browser "user4-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-4" field "name" in "[data-testid='canvas-user-search-input']"
* waiting for text "user:user-4.name" to appear in "[data-testid='canvas-share-modal']"
* clicking on text "user:user-4.name" in "[data-testid='canvas-share-modal']"
* clicking on text "Editor" in "[data-testid='canvas-share-modal']"
* clicking on text "Viewer"
* clicking button with text "Share"

## Channel Owner adds user as Editor
* using browser
* Logging in user "user-3" on temp browser "user3-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-3" field "name" in "[data-testid='canvas-user-search-input']"
* waiting for text "user:user-3.name" to appear in "[data-testid='canvas-share-modal']"
* clicking on text "user:user-3.name" in "[data-testid='canvas-share-modal']"
* clicking button with text "Share"

## Channel Owner toggles canvas visibility
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* clicking on "[data-testid='canvas-visibility-select']"
* clicking on text "Anyone with the link"
* verifying "Anyone in the workspace with the link can view" is visible in "[data-testid='canvas-share-modal']"
