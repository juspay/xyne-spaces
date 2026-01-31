@e2e
Feature: Unauthenticated User Redirect
  As a user not logged in
  When I open the xyne space
  I should be redirected to the login screen
  And I should see the login button

  Scenario: Setup browser session
    Given a browser "e2e-browser1" with viewport 1280x720
    And using browser "e2e-browser1"
    And I am not logged in

  Scenario Outline: Unauthenticated user is redirected to login screen for <endpoint>
    When I open the Xyne-Space at "<endpoint>"
    Then the user should be redirected to "/auth"
    And I should see a button with text "Sign in with Google"

    Examples:
      | endpoint        |
      | /               |
      | /onboarding     |
      | /chat           |
      | /tickets        |
      | /agents         |
      | /knowledge-base |
      | /analytics      |
      | /projects       |
      | /user-groups    |
      | /listProjects   |
      | /calls          |
      | /vscode         |
      | /forms          |
      | /support        |
