@e2e @messaging @setup @dm @group-chat @channel @canvas
Feature: Messages Test Setup
  Initialize browser instances, login users, and complete onboarding
  This feature must run before other messaging tests

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
      # Email-based logins so each browser maps to a stable, distinct user.
      # Without an explicit email, the backend auto-increments a counter that
      # collides with the indices the project-setup feature picks, causing
      # two browsers to share one user identity.
      | user  | browser       | user_context | auth_url                                              | landing_page |
      | user2 | user2-browser | user2        | /auth?email=test-user-email-2@xyne-test.local         | /chat        |
      | user3 | user3-browser | user3        | /auth?email=test-user-email-3@xyne-test.local         | /chat        |
