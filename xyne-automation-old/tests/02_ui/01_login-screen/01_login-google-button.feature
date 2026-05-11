@ui
Feature: Login Screen Google Sign-In
  As a user
  I want to see a Google sign-in button on the login screen
  So that I can sign in with my Google account

  Scenario: Setup browser session
    Given a browser "ui-browser" with viewport 1280x720 using firefox

  Scenario: Google sign-in button is visible on login screen
    Given using browser "ui-browser"
    And I open the Xyne-Space at "/auth"
    Then I should see a button with text "Sign in with Google"

  Scenario: Cleanup browser session
    Given close the browser "ui-browser"
