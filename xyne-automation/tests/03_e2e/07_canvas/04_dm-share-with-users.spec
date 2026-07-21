# DM Canvas Sharing with Users
> Share DM canvas with other users

## DM Owner opens share modal
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-share-button']"
* verifying "Who has access" is visible in "[data-testid='canvas-share-modal']"

## DM Owner adds user as Viewer
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Logging in user "user-4" on temp browser "user4-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-4" field "name" in "[data-testid='canvas-user-search-input']"
* waiting for text "user:user-4.name" to appear in "[data-testid='canvas-share-modal']"
* clicking on text "user:user-4.name" in "[data-testid='canvas-share-modal']"
* clicking on text "Editor" in "[data-testid='canvas-share-modal']"
* clicking on text "Viewer"
* clicking button with text "Share"
