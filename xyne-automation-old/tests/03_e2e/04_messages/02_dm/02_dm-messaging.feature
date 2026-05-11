@e2e @messaging @dm
Feature: DM Messaging E2E Flow
  As a user
  I want to verify direct messages are received by other users
  So that we can communicate privately

  @dm-receive-verify
  Scenario Outline: <user> sees the message in the DM
    Given using browser "<browser>"
    When I open the Xyne-Space at "user1-user2-dm"
    Then I should see "Hello from user1!" in the element "[data-testid='virtuoso-item-list']"

    Examples:
      | user  | browser       |
      | User1 | user1-browser |
      | User2 | user2-browser |
