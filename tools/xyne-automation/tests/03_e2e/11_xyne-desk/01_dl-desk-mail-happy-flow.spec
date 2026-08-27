# Xyne Desk DL mail happy flow

## Create DL desk, receive customer mail, and send a reply through the mock provider
* using browser
* logging in as user "admin-1"
* Creating DL Desk channel "channel-desk-dl-happy-flow" for user "admin-1" in project "project-1"
* clearing mock Desk sent mails for channel "channel-desk-dl-happy-flow" user "admin-1"
* generating mock incoming Desk email "customer-mail-1"
* injecting mock incoming Desk email "customer-mail-1" into channel "channel-desk-dl-happy-flow" for user "admin-1"
* verifying mock Desk email "customer-mail-1" was ingested
* replying to mock Desk email "customer-mail-1" from channel "channel-desk-dl-happy-flow" for user "admin-1"
* verifying mock Desk sent mail count is "1" for incoming email "customer-mail-1"
* verifying latest mock Desk sent mail matches incoming email "customer-mail-1"
