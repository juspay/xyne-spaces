@e2e @messaging @channel @canvas
Feature: Channel Joining E2E Flow
  As a user
  I want to add other users to a channel
  So that team members can participate in the channel

  @channel-joining @channel-add-member
  Scenario Outline: User1 adds users to the channel
    Given using browser "user1-browser"
    When I open the Xyne-Space at "user1-channel-1"
    And I click on "[data-testid='channel-info-trigger']"
    And I click on "[data-testid='add-people-button']"
    And I type "<email>" on the element "[data-testid='user-search-input']"
    And I click on text "<name>" in the element "[data-testid='user-search-results']"
    And I click on "[data-testid='add-people-submit']"

    Examples:
      | email                    | name                    |
      | user:user2-browser.email | user:user2-browser.name |
      | user:user3-browser.email | user:user3-browser.name |

  @channel-joining @channel-verify-membership
  Scenario Outline: Users can see the channel after being added
    Given using browser "<browser>"
    When I open the Xyne-Space at "/chat"
    Then I should see "user:user1-browser.id" in the element "[data-testid='channel-list']"

    Examples:
      | browser       |
      | user2-browser |
      | user3-browser |
