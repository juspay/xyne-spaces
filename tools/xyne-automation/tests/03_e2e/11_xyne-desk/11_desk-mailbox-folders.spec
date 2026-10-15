# Xyne Desk mailbox folders
> Per-agent mailbox actions on a Desk ticket move it between the Inbox, All Mail, Starred and Spam folders, while other tickets stay in the Inbox.

## Archived ticket leaves the Inbox and stays in All Mail
* Setting up Desk channel "channel-desk-folder-archive" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-archive" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-inbox" in channel "channel-desk-folder-archive" for user "admin-1"
* Opening Desk ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-archive" for user "admin-1"
* clicking on "[aria-label='Remove from Inbox (archive)']"
* waiting for zero sync to settle
* Verifying Desk channel "channel-desk-folder-archive" lists "ticket-desk-folder-inbox" but not "ticket-desk-folder-moved" for user "admin-1"
* Opening Desk mailbox folder "All Mail"
* verifying stored user "admin-1" ticket "ticket-desk-folder-moved" field "title" is visible in "[data-testid='support-page']"

## Starred ticket shows in the Starred folder
* Setting up Desk channel "channel-desk-folder-star" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-star" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-inbox" in channel "channel-desk-folder-star" for user "admin-1"
* Opening Desk ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-star" for user "admin-1"
* clicking on "[aria-label='Star']"
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-folder-star" for user "admin-1"
* Opening Desk mailbox folder "Starred"
* verifying stored user "admin-1" ticket "ticket-desk-folder-moved" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-folder-inbox" field "title" is not visible in "[data-testid='support-page']"

## Ticket reported as spam leaves the Inbox and shows in Spam
* Setting up Desk channel "channel-desk-folder-spam" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-spam" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-folder-inbox" in channel "channel-desk-folder-spam" for user "admin-1"
* Opening Desk ticket "ticket-desk-folder-moved" in channel "channel-desk-folder-spam" for user "admin-1"
* clicking on "[aria-label='More actions']"
* clicking on "[data-track-name='MailboxSpam']"
* waiting for zero sync to settle
* Verifying Desk channel "channel-desk-folder-spam" lists "ticket-desk-folder-inbox" but not "ticket-desk-folder-moved" for user "admin-1"
* Opening Desk mailbox folder "Spam"
* verifying stored user "admin-1" ticket "ticket-desk-folder-moved" field "title" is visible in "[data-testid='support-page']"
