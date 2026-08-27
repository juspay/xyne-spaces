# Xyne Desk personal mailbox advanced flow

## Personal mailbox ticket UI, update, reply-all, and attachment happy flow
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-personal-advanced-flow" for user "admin-1" in project "project-1"
* clearing mock Desk sent mails for channel "channel-desk-personal-advanced-flow" user "admin-1"
* generating mock incoming Desk email "personal-advanced-mail-1" with reply-all recipients and attachment
* injecting mock incoming Desk email "personal-advanced-mail-1" into channel "channel-desk-personal-advanced-flow" for user "admin-1"
* verifying mock Desk email "personal-advanced-mail-1" was ingested
* verifying mock Desk ticket for email "personal-advanced-mail-1" has expected subject body sender and attachment
* verifying Desk data shows mock email "personal-advanced-mail-1" in channel "channel-desk-personal-advanced-flow" for user "admin-1"
* updating mock Desk ticket for email "personal-advanced-mail-1" priority to "HIGH" and status to "STARTED"
* verifying mock Desk ticket for email "personal-advanced-mail-1" priority is "HIGH" and status is "STARTED"
* replying all to mock Desk email "personal-advanced-mail-1" from channel "channel-desk-personal-advanced-flow" for user "admin-1"
* verifying mock Desk sent mail count is "1" for incoming email "personal-advanced-mail-1"
* verifying latest mock Desk sent reply-all mail matches incoming email "personal-advanced-mail-1"
