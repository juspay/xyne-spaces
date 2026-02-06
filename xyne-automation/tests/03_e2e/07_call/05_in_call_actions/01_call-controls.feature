@e2e @call @call-controls
Feature: Call Controls (Deep Dive)
  As a user in an active call
  I want to control my audio, camera, and screen sharing
  So that I can manage my participation in the call

  # ============================================
  # Default State Verification
  # ============================================

  @call-controls-default
  Scenario: Verify default call state after joining
    Given using browser "user1-browser"
    When I open the Xyne-Space at "/calls"
    Then I should see active call in the element "[data-testid='call-history-list']"
    Then I should see "user:user2-browser.name", "user:user3-browser.name" in active call in the element "[data-testid='call-history-list']"
    And I click on "[data-testid='Active']"

  # ============================================
  # Microphone Controls
  # ============================================

  @call-controls-mic
  Scenario: Toggle microphone on and off
    Given using browser "user1-browser"
    # default
    Then the element "[data-testid='mic-toggle-button']" should have attribute "title" equal to "Mute microphone"
    # Unmute
    And I click on "[data-testid='mic-toggle-button']"
    Then the element "[data-testid='mic-toggle-button']" should have attribute "title" equal to "Unmute microphone"
    # Mute again
    When I click on "[data-testid='mic-toggle-button']"
    Then the element "[data-testid='mic-toggle-button']" should have attribute "title" equal to "Mute microphone"

  # ============================================
  # camera Controls
  # ============================================

  @call-controls-camera
  Scenario: Toggle camera on and off
    Given using browser "user1-browser"
    # default
    Then the element "[data-testid='camera-toggle-button']" should have attribute "title" equal to "Turn on camera"
    # Turn camera on
    And I click on "[data-testid='camera-toggle-button']"
    Then the element "[data-testid='camera-toggle-button']" should have attribute "title" equal to "Turn off camera"
    # Turn camera off
    When I click on "[data-testid='camera-toggle-button']"
    Then the element "[data-testid='camera-toggle-button']" should have attribute "title" equal to "Turn on camera"

  # ============================================
  # End Call
  # ============================================

  @call-controls-end
  Scenario: End call from controls
    Given using browser "user1-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"
    Given using browser "user2-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"
    Given using browser "user3-browser"
    And I click on "[data-testid='end-call-button']"
    Then I should not see "[data-testid='call-window']"

