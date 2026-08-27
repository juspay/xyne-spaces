# Xyne Desk connection lifecycle

## Personal mailbox can disconnect and reconnect through mock Desk setup
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-connect-lifecycle" for user "admin-1" in project "project-1"
* verifying Desk channel "channel-desk-connect-lifecycle" is connected for user "admin-1"
* disconnecting Desk mailbox for channel "channel-desk-connect-lifecycle" user "admin-1"
* verifying Desk channel "channel-desk-connect-lifecycle" is disconnected for user "admin-1"
* reconnecting mock Desk mailbox for channel "channel-desk-connect-lifecycle" user "admin-1"
* verifying Desk channel "channel-desk-connect-lifecycle" is connected for user "admin-1"

## Slack Desk channel can disconnect after mock connect
* using browser
* logging in as user "admin-1"
* Creating Slack Desk channel "channel-desk-slack-connect-lifecycle" for user "admin-1" in project "project-1"
* verifying Desk channel "channel-desk-slack-connect-lifecycle" is connected for user "admin-1"
* disconnecting Slack Desk channel "channel-desk-slack-connect-lifecycle" for user "admin-1"
* verifying Desk channel "channel-desk-slack-connect-lifecycle" is disconnected for user "admin-1"
