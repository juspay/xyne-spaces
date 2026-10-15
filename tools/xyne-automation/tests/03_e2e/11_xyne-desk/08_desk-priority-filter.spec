# Xyne Desk priority filter
> For every priority value, an agent sets a Desk ticket's priority from the ticket header and the Desk priority filter lists only tickets with that priority.

|priority|otherPriority|
|--------|-------------|
|Low     |High         |
|Medium  |Low          |
|High    |Low          |
|Critical|Low          |

## Desk priority filter lists only tickets with the chosen priority
* Setting up Desk channel "channel-desk-priority-filter" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-filter-match" in channel "channel-desk-priority-filter" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-filter-other" in channel "channel-desk-priority-filter" for user "admin-1"
* Opening Desk ticket "ticket-desk-filter-match" in channel "channel-desk-priority-filter" for user "admin-1"
* Setting open Desk ticket priority to <priority>
* Opening Desk ticket "ticket-desk-filter-other" in channel "channel-desk-priority-filter" for user "admin-1"
* Setting open Desk ticket priority to <otherPriority>
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-priority-filter" for user "admin-1"
* Filtering Desk tickets by priority <priority>
* verifying stored user "admin-1" ticket "ticket-desk-filter-match" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-filter-other" field "title" is not visible in "[data-testid='support-page']"
