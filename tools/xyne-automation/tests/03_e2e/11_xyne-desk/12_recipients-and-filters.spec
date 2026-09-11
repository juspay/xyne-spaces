# Xyne Desk recipients and filters

## Reply recipients and Desk filters remain correct
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-recipients-filters" for user "admin-1" in project "project-1"
* generating mock incoming Desk email "recipient-filter-mail-1" with reply-all recipients and attachment
* injecting mock incoming Desk email "recipient-filter-mail-1" into channel "channel-desk-recipients-filters" for user "admin-1"
* verifying mock Desk email "recipient-filter-mail-1" was ingested
* replying to mock Desk email "recipient-filter-mail-1" from channel "channel-desk-recipients-filters" for user "admin-1"
* verifying mock Desk sent mail count is "1" for incoming email "recipient-filter-mail-1"
* verifying latest mock Desk sent mail matches incoming email "recipient-filter-mail-1"
* replying all to mock Desk email "recipient-filter-mail-1" from channel "channel-desk-recipients-filters" for user "admin-1"
* verifying mock Desk sent mail count is "2" for incoming email "recipient-filter-mail-1"
* verifying latest mock Desk sent reply-all mail matches incoming email "recipient-filter-mail-1"
* verifying Desk priority and status filters work for channel "channel-desk-recipients-filters" user "admin-1"
