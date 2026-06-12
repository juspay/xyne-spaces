# Canvas List Views E2E Flow
> Verify canvas-list renders both inside a channel's canvas tab and on the personal "My Canvas" page.

## User views canvas list inside a channel
* Using browser
* Ensuring user "user-1" is logged in
* Navigating to channel "channel-1" for user "user-1"
* clicking on "[data-testid='channel-tab-canvas']"
* waiting for network to be idle
* verifying "[data-testid='canvas-list']" is visible

## User views My Canvas page
* Using browser
* Ensuring user "user-1" is logged in
* navigating via sidebar to "my-canvas"
* waiting for network to be idle
* verifying "[data-testid='canvas-list']" is visible
