# Back and Forward Navigation UI Test
> Verify the global top bar back and forward buttons return the user to previously visited pages

## User navigates back and forward through visited pages
* Using browser
* Ensuring user "user-1" is logged in
* waiting for "[data-testid='channel-list']" to appear
* clicking on "[data-testid='nav-recordings']"
* waiting for "[data-testid='recordings-page']" to appear
* clicking on "[aria-label='go-back']"
* verifying "[data-testid='channel-list']" is visible
* clicking on "[aria-label='go-next']"
* verifying "[data-testid='recordings-page']" is visible
