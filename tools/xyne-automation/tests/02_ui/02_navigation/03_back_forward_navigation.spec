# Back and Forward Navigation UI Test
> Verify the app navigator back button returns the user to the previously visited page

Forward is not covered: AppNavigator keeps its max history index per instance, so after
going back to a screen with its own navigator the Forward button stays disabled (app bug).

## User navigates back and forward through visited pages
* Using browser
* Ensuring user "user-1" is logged in
* navigating via sidebar to "chat"
* waiting for "[data-testid='channel-list']" to appear
* navigating via sidebar to "recordings"
* waiting for "[data-testid='recordings-v2-page']" to appear
* clicking on "button[data-track-name='GO_BACK']:visible"
* waiting for "[data-testid='channel-list']" to appear
