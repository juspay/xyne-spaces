# Xyne Desk compose merge and unmerge

## Compose mail creates a Desk ticket and the ticket can be merged and unmerged
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-compose-merge-flow" for user "admin-1" in project "project-1"
* clearing mock Desk sent mails for channel "channel-desk-compose-merge-flow" user "admin-1"
* composing mock Desk email "compose-mail-1" from channel "channel-desk-compose-merge-flow" for user "admin-1"
* verifying mock Desk email "compose-mail-1" was ingested
* verifying latest mock Desk composed mail matches "compose-mail-1"
* generating mock incoming Desk email "merge-target-mail-1"
* injecting mock incoming Desk email "merge-target-mail-1" into channel "channel-desk-compose-merge-flow" for user "admin-1"
* verifying mock Desk email "merge-target-mail-1" was ingested
* merging mock Desk ticket "compose-mail-1" into "merge-target-mail-1" as user "admin-1"
* verifying mock Desk ticket "compose-mail-1" is merged into "merge-target-mail-1"
* unmerging mock Desk ticket "compose-mail-1" as user "admin-1"
* verifying mock Desk ticket "compose-mail-1" is unmerged
