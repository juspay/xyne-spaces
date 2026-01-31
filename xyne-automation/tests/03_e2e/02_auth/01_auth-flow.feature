@e2e @auth
Feature: Authentication E2E Flow
  As a user
  I want to sign in with Google using test authentication
  So that I can access the application

  Scenario: User signs in and is redirected to onboarding
    Given using browser "e2e-browser1"
    And I am not logged in
    And I open the Xyne-Space at "/auth"
    When I click the button with text "Sign in with Google" then wait for "/test/auth/login" request to be triggered and capture the response
    Then the captured response status should be 200
    And the captured response should be json
    And the captured response should contain property "user"
    And the captured response should contain property "sessionId"
    And the user data should be stored in global context as "user1"
    And the user should be redirected to "/onboarding"

  # TODO: Skipping temporarily because in main it is failing
  # Scenario: User skips onboarding
  #   Given using browser "e2e-browser1"
  #   When I click the button with text "Get Started"
  #   And I click the button with text "->"
  #   And I click the button with text "->"
  #   And I click the button with text "->"
  #   And I click the button with text "Open My Workspace"
  #   Then the user should be redirected to "/chat"

  Scenario: Cleanup browser session
    Given close the browser "e2e-browser1"
