# Xyne Desk Gmail redelivery
> Gmail Pub/Sub redelivers on failure; Desk must create each ticket exactly once.

## Redelivered batch creates each ticket once
* Setting up Desk channel "channel-desk-redelivery" for user "admin-1"
* generating "5" Desk email tickets as batch "ticket-desk-batch" in channel "channel-desk-redelivery" for user "admin-1"
* delivering Desk email batch "ticket-desk-batch" for user "admin-1"
* verifying Desk delivery created "5" tickets and found "0" duplicates
* delivering Desk email batch "ticket-desk-batch" for user "admin-1"
* verifying Desk delivery created "0" tickets and found "5" duplicates
* verifying every ticket of Desk batch "ticket-desk-batch" is listed for user "admin-1"

## Batch that fails mid-way is redelivered without duplicates
* Setting up Desk channel "channel-desk-retry" for user "admin-1"
* generating "5" Desk email tickets as batch "ticket-desk-retry" in channel "channel-desk-retry" for user "admin-1"
* delivering Desk email batch "ticket-desk-retry" for user "admin-1" failing at message "2"
* verifying Desk delivery failed with a retryable error
* delivering Desk email batch "ticket-desk-retry" for user "admin-1"
* verifying Desk delivery created "3" tickets and found "2" duplicates
* verifying every ticket of Desk batch "ticket-desk-retry" is listed for user "admin-1"
