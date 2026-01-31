@e2e @project @setup
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
    And I open the Xyne-Space at "<landing_page>"

    Examples:
      | user  | browser       | user_context | auth_url           | landing_page   |
      | Admin | admin-browser | admin        | /auth?isAdmin=true | /listprojects  |
      | User1 | user1-browser | user1        | /auth              | /chat          |
