# Xyne Desk AI rewrite and compose controls

## Desk ticket exposes compose Ask AI and rewrite controls without invoking external AI
* using browser
* logging in as user "admin-1"
* Creating personal Desk channel "channel-desk-ai-rewrite-controls" for user "admin-1" in project "project-1"
* generating mock incoming Desk email "ai-rewrite-mail-1"
* injecting mock incoming Desk email "ai-rewrite-mail-1" into channel "channel-desk-ai-rewrite-controls" for user "admin-1"
* verifying mock Desk email "ai-rewrite-mail-1" was ingested
* verifying Desk compose control is available for channel "channel-desk-ai-rewrite-controls" user "admin-1"
* verifying Desk AI and rewrite controls are available for email "ai-rewrite-mail-1"
