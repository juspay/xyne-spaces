# Xyne Desk auto-merge and manual controls

## Auto Merge ON combines matching emails
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-auto-merge-on" for user "admin-1" in project "project-1"
* setting Desk auto-merge "on" for channel "channel-desk-auto-merge-on" user "admin-1"
* generating mock Desk email pair "auto-merge-on-mail-1" and "auto-merge-on-mail-2" with the same subject and domain
* injecting mock incoming Desk email "auto-merge-on-mail-1" into channel "channel-desk-auto-merge-on" for user "admin-1"
* waiting for "2" seconds
* injecting mock incoming Desk email "auto-merge-on-mail-2" into channel "channel-desk-auto-merge-on" for user "admin-1"
* verifying mock Desk emails "auto-merge-on-mail-1" and "auto-merge-on-mail-2" share one conversation

## Auto Merge OFF keeps emails separate and manual merge/demerge remains available
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-auto-merge-off" for user "admin-1" in project "project-1"
* setting Desk auto-merge "off" for channel "channel-desk-auto-merge-off" user "admin-1"
* generating mock Desk email pair "auto-merge-off-mail-1" and "auto-merge-off-mail-2" with the same subject and domain
* injecting mock incoming Desk email "auto-merge-off-mail-1" into channel "channel-desk-auto-merge-off" for user "admin-1"
* injecting mock incoming Desk email "auto-merge-off-mail-2" into channel "channel-desk-auto-merge-off" for user "admin-1"
* verifying mock Desk emails "auto-merge-off-mail-1" and "auto-merge-off-mail-2" have separate conversations
* merging mock Desk ticket "auto-merge-off-mail-1" into "auto-merge-off-mail-2" as user "admin-1"
* verifying mock Desk ticket "auto-merge-off-mail-1" is merged into "auto-merge-off-mail-2"
* unmerging mock Desk ticket "auto-merge-off-mail-1" through the UI for user "admin-1"
* verifying mock Desk ticket "auto-merge-off-mail-1" is unmerged
