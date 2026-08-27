# Xyne Desk multiple DL routing

## Multiple DL desk channels receive their own incoming mails
* using browser
* logging in as user "admin-1"
* Creating DL Desk channel "channel-desk-dl-routing-a" for user "admin-1" in project "project-1"
* Creating DL Desk channel "channel-desk-dl-routing-b" for user "admin-1" in project "project-1"
* Creating DL Desk channel "channel-desk-dl-routing-c" for user "admin-1" in project "project-1"
* generating mock incoming Desk email "routing-mail-a"
* generating mock incoming Desk email "routing-mail-b"
* generating mock incoming Desk email "routing-mail-c"
* injecting mock incoming Desk email "routing-mail-a" into channel "channel-desk-dl-routing-a" for user "admin-1"
* injecting mock incoming Desk email "routing-mail-b" into channel "channel-desk-dl-routing-b" for user "admin-1"
* injecting mock incoming Desk email "routing-mail-c" into channel "channel-desk-dl-routing-c" for user "admin-1"
* verifying mock Desk email "routing-mail-a" was ingested
* verifying mock Desk email "routing-mail-b" was ingested
* verifying mock Desk email "routing-mail-c" was ingested
* verifying Desk channel "channel-desk-dl-routing-a" does not contain email "routing-mail-b" for user "admin-1"
* verifying Desk channel "channel-desk-dl-routing-a" does not contain email "routing-mail-c" for user "admin-1"
* verifying Desk channel "channel-desk-dl-routing-b" does not contain email "routing-mail-a" for user "admin-1"
* verifying Desk channel "channel-desk-dl-routing-b" does not contain email "routing-mail-c" for user "admin-1"
* verifying Desk channel "channel-desk-dl-routing-c" does not contain email "routing-mail-a" for user "admin-1"
* verifying Desk channel "channel-desk-dl-routing-c" does not contain email "routing-mail-b" for user "admin-1"
