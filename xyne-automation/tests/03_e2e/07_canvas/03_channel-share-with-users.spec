# Channel Canvas Sharing with Users
> Share canvas with other users for collaboration

## Channel Owner opens share modal
* Using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* verifying "Make visible to channel" is visible in "[data-testid='canvas-share-modal']"
* verifying "Anyone with this link can view" is visible in "[data-testid='canvas-share-modal']"
* verifying "People with access" is visible in "[data-testid='canvas-share-modal']"
* verifying "Owner" is visible in "[data-testid='canvas-share-modal']"
* verifying "[data-testid='user-search-input']" is visible

## Channel Owner can copy shareable link
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* clicking on "[data-testid='canvas-copy-link-button']"
* verifying "[data-testid='canvas-copy-link-button']" is visible

## Channel Owner adds user as Viewer
* using browser
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-2" field "name" in "[data-testid='user-search-input']"
* waiting for "[data-testid='user-search-results']" to appear
* clicking on "[data-testid='user-search-results'] li:first-child"
* clicking button with text "Viewer"

## Channel Owner adds user as Editor
* using browser
* Logging in user "user-3" on temp browser "user3-browser-1"
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* typing stored user "user-3" field "name" in "[data-testid='user-search-input']"
* waiting for "[data-testid='user-search-results']" to appear
* clicking on "[data-testid='user-search-results'] li:first-child"
* clicking button with text "Editor"

## Channel Owner toggles canvas visibility
* using browser
* Ensuring user "user-1" is logged in
* Creating channel canvas for user "user-1"
* clicking on "[data-testid='canvas-share-button']"
* clicking on "[data-testid='canvas-visibility-toggle']"
* verifying "Make visible to channel" is visible in "[data-testid='canvas-share-modal']"
