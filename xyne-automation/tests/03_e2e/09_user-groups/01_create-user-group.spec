# Create User Group E2E Flow
> Organize users into groups for easier management

## Admin creates new user group
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-1"
* Logging in user "user-2" on temp browser "user2-browser-1"
* Ensuring user "admin-1" is logged in
* clicking on "[data-testid='nav-user-groups']"
* clicking on "[data-testid='create-user-group-btn']"
* typing "Engineering Team" in "[data-testid='user-group-name-input']"
* typing "Team Description" in "textarea[placeholder*='Enter user group description']"
* clicking on "[data-testid='members-tab-btn']"
* typing stored user "user-1" field "email" in "[data-testid='search-members-input']"
* clicking on stored user "user-1" field "name" in "[data-testid='dialog-content']"
* clicking on "[data-testid='submit-user-group-btn']"
* verifying "Engineering Team" is visible in "body"
