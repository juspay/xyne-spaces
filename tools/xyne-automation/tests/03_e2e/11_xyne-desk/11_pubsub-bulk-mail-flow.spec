# Xyne Desk deterministic Pub/Sub bulk mail flow

## Bulk Gmail Pub/Sub delivery reaches Desk exactly once
* using browser
* Ensuring user "admin-1" is logged in
* Creating personal Desk channel "channel-desk-pubsub-bulk" for user "admin-1" in project "project-1"
* Creating personal Desk channel "channel-desk-pubsub-bulk-other" for user "admin-1" in project "project-1"
* generating "25" deterministic Pub/Sub Gmail messages as batch "pubsub-bulk-1"
* generating "10" deterministic Pub/Sub Gmail messages as batch "pubsub-bulk-other-1"
* publishing deterministic Pub/Sub batch "pubsub-bulk-1" to Desk channel "channel-desk-pubsub-bulk" for user "admin-1"
* publishing deterministic Pub/Sub batch "pubsub-bulk-other-1" to Desk channel "channel-desk-pubsub-bulk-other" for user "admin-1"
* republishing deterministic Pub/Sub batch "pubsub-bulk-1" to Desk channel "channel-desk-pubsub-bulk" for user "admin-1"
* verifying Desk channel "channel-desk-pubsub-bulk-other" has no tickets from Pub/Sub batch "pubsub-bulk-1" for user "admin-1"
* verifying Desk channel "channel-desk-pubsub-bulk" has no tickets from Pub/Sub batch "pubsub-bulk-other-1" for user "admin-1"

## Retryable failure mid-batch is redelivered without duplicates
* using browser
* Ensuring user "admin-1" is logged in
* Creating personal Desk channel "channel-desk-pubsub-retry" for user "admin-1" in project "project-1"
* generating "10" deterministic Pub/Sub Gmail messages as batch "pubsub-retry-1"
* publishing deterministic Pub/Sub batch "pubsub-retry-1" to Desk channel "channel-desk-pubsub-retry" for user "admin-1" failing at message "4"
* redelivering failed Pub/Sub batch "pubsub-retry-1" to Desk channel "channel-desk-pubsub-retry" for user "admin-1"
* republishing deterministic Pub/Sub batch "pubsub-retry-1" to Desk channel "channel-desk-pubsub-retry" for user "admin-1"
