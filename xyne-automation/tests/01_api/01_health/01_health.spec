# Backend Health Check

## Health endpoint returns success
* ensuring backend API is accessible
* sending GET request to "/api/health"
* verifying response status is "200"
* verifying response content-type is JSON
* verifying response property "success" equals "true"
