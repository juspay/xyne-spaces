# DM Canvas Sharing with Users
> Share DM canvas with other users

## DM Owner opens share modal
* Using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-share-button']"
* verifying "People with access" is visible in "[data-testid='canvas-share-modal']"

## DM Owner adds user as Viewer
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating DM canvas for user "user-1" with user "user-2"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-2" field "name" in "[data-testid='user-search-input']"
* waiting for "[data-testid='user-search-results']" to appear
* clicking on "[data-testid='user-search-results'] li:first-child"
* clicking button with text "Viewer"
