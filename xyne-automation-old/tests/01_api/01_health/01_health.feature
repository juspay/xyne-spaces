@api
Feature: Backend Health Check
  As a developer
  I want to verify the backend API is healthy
  So that I can ensure the service is running

  Scenario: Health endpoint returns success
    Given the backend API is accessible
    When I send a GET request to "/api/health"
    Then the response status should be 200
    And the response content-type should be JSON
    And the response property "success" should equal "true"
