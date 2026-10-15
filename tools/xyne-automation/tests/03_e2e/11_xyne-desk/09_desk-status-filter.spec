# Xyne Desk status filter
> For every stage of the Desk board (To Do, In Progress, Review, Completed), an agent moves a Desk ticket to that stage from the ticket header and the Desk status filter lists only tickets in that stage.

|status     |otherStatus|
|-----------|-----------|
|To Do      |In Progress|
|In Progress|To Do      |
|Review     |To Do      |
|Completed  |To Do      |

## Desk status filter lists only tickets in the chosen stage
* Setting up Desk channel "channel-desk-status-filter" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-filter-match" in channel "channel-desk-status-filter" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-filter-other" in channel "channel-desk-status-filter" for user "admin-1"
* Opening Desk ticket "ticket-desk-filter-match" in channel "channel-desk-status-filter" for user "admin-1"
* Setting open Desk ticket status to <status>
* Opening Desk ticket "ticket-desk-filter-other" in channel "channel-desk-status-filter" for user "admin-1"
* Setting open Desk ticket status to <otherStatus>
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-status-filter" for user "admin-1"
* Filtering Desk tickets by status <status>
* verifying stored user "admin-1" ticket "ticket-desk-filter-match" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-filter-other" field "title" is not visible in "[data-testid='support-page']"
