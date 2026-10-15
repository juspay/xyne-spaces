# Xyne Desk merge and unmerge
> An agent merges two Desk tickets from the list, sees the merged email inside the parent, then unmerges it.

## Agent merges two tickets from the list and unmerges them from the parent
* Setting up Desk channel "channel-desk-merge" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-merge-parent" in channel "channel-desk-merge" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-merge-child" in channel "channel-desk-merge" for user "admin-1"
* Opening Desk channel "channel-desk-merge" for user "admin-1"
* Selecting Desk ticket "ticket-desk-merge-parent" in the list for user "admin-1"
* Selecting Desk ticket "ticket-desk-merge-child" in the list for user "admin-1"
* Merging selected Desk tickets into "ticket-desk-merge-parent" for user "admin-1"
* waiting for zero sync to settle
* Verifying Desk channel "channel-desk-merge" lists "ticket-desk-merge-parent" but not "ticket-desk-merge-child" for user "admin-1"
* Opening Desk ticket "ticket-desk-merge-parent" in channel "channel-desk-merge" for user "admin-1"
* verifying stored user "admin-1" ticket "ticket-desk-merge-child" field "description" is visible in an iframe inside "[data-testid='support-page']"
* clicking on "[data-track-name='UnmergeTicket']"
* waiting for zero sync to settle
* Verifying Desk ticket "ticket-desk-merge-child" is listed in channel "channel-desk-merge" for user "admin-1"
