# Xyne Desk deterministic Pub/Sub bulk mail flow

## Bulk Gmail Pub/Sub delivery reaches Desk exactly once
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-pubsub-bulk" for user "admin-1" in project "project-1"
* generating "25" deterministic Pub/Sub Gmail messages as batch "pubsub-bulk-1"
* publishing deterministic Pub/Sub batch "pubsub-bulk-1" to Desk channel "channel-desk-pubsub-bulk" for user "admin-1"
* republishing deterministic Pub/Sub batch "pubsub-bulk-1" to Desk channel "channel-desk-pubsub-bulk" for user "admin-1"
