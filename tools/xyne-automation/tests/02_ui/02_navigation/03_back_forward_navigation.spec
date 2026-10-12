# Back and Forward Navigation UI Test
> Verify the global top bar back and forward buttons return the user to previously visited pages

## User navigates back and forward through visited pages
* Using browser
* Ensuring user "user-1" is logged in
* navigating via sidebar to "chat"
* waiting for "[data-testid='channel-list']" to appear
* navigating via sidebar to "recordings"
* waiting for "[data-testid='recordings-v2-page']" to appear
* clicking on "button[aria-label='go-back']"
* waiting for "[data-testid='channel-list']" to appear
* clicking on "button[aria-label='go-next']"
* waiting for "[data-testid='recordings-v2-page']" to appear
