@e2e @project @setup @messaging @canvas
Feature: Project Test Setup
  Initialize admin browser instance and login
  This feature must run before other project tests

  Scenario Outline: Initialize and login <user>
    Given a browser "<browser>" with viewport 1280x720
    And using browser "<browser>"
    And I am not logged in
    And I open the Xyne-Space at "<auth_url>"
    When I click the button with text "Sign in with Google" then wait for "/test/auth/login" request to be triggered and capture the response
    Then the captured response status should be 200
    And the user data should be stored in global context as "<user_context>"
    # Complete onboarding flow for new users
    And I click the button with text "Get Started ->"
    And I wait for 1 seconds
    And I click the button with text "->"
    And I wait for 1 seconds
    And I click the button with text "->"
    And I wait for 1 seconds
    And I click the button with text "->"
    And I wait for 1 seconds
    And I click the button with text "Open My Workspace"
    And I wait for 2 seconds
    And I open the Xyne-Space at "<landing_page>"

    Examples:
      # The dashboard's authMachine only forwards `email` and `setAsNewUser`
      # to /test/auth/login (the legacy ?isAdmin=true URL flag is dropped).
      # Authenticate via an admin-pattern email so the backend grants the
      # ADMIN resource permissions — same mechanism gauge uses.
      | user  | browser       | user_context | auth_url                                              | landing_page |
      | Admin | admin-browser | admin        | /auth?email=test-admin-email-1@xyne-test.local        | /chat/dir    |
      | User1 | user1-browser | user1        | /auth?email=test-user-email-1@xyne-test.local         | /chat        |
