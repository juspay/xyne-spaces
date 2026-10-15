# Xyne Desk bulk update
> An agent selects several Desk tickets in the list and changes them together from the bulk toolbar; tickets that were not selected stay unchanged.

## Agent bulk-sets priority of the selected tickets
* Setting up Desk channel "channel-desk-bulk-priority" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-a" in channel "channel-desk-bulk-priority" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-b" in channel "channel-desk-bulk-priority" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-untouched" in channel "channel-desk-bulk-priority" for user "admin-1"
* Opening Desk channel "channel-desk-bulk-priority" for user "admin-1"
* Selecting Desk ticket "ticket-desk-bulk-a" in the list for user "admin-1"
* Selecting Desk ticket "ticket-desk-bulk-b" in the list for user "admin-1"
* Bulk setting priority of selected Desk tickets to "Critical"
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-bulk-priority" for user "admin-1"
* Filtering Desk tickets by priority "Critical"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-a" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-b" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-untouched" field "title" is not visible in "[data-testid='support-page']"

## Agent bulk-moves the selected tickets to a stage
* Setting up Desk channel "channel-desk-bulk-stage" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-a" in channel "channel-desk-bulk-stage" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-b" in channel "channel-desk-bulk-stage" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-untouched" in channel "channel-desk-bulk-stage" for user "admin-1"
* Opening Desk channel "channel-desk-bulk-stage" for user "admin-1"
* Selecting Desk ticket "ticket-desk-bulk-a" in the list for user "admin-1"
* Selecting Desk ticket "ticket-desk-bulk-b" in the list for user "admin-1"
* Bulk moving selected Desk tickets to stage "In Progress"
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-bulk-stage" for user "admin-1"
* Filtering Desk tickets by status "In Progress"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-a" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-b" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-untouched" field "title" is not visible in "[data-testid='support-page']"

## Agent selects all tickets and bulk-sets their priority
* Setting up Desk channel "channel-desk-bulk-select-all" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-a" in channel "channel-desk-bulk-select-all" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-b" in channel "channel-desk-bulk-select-all" for user "admin-1"
* Opening Desk channel "channel-desk-bulk-select-all" for user "admin-1"
* clicking on "[aria-label='Selection options']"
* clicking on "[data-track-name='SelectAllAll']"
* Bulk setting priority of selected Desk tickets to "High"
* waiting for zero sync to settle
* Opening Desk channel "channel-desk-bulk-select-all" for user "admin-1"
* Filtering Desk tickets by priority "High"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-a" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-bulk-b" field "title" is visible in "[data-testid='support-page']"

## Agent clears the ticket selection
* Setting up Desk channel "channel-desk-bulk-clear" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-bulk-a" in channel "channel-desk-bulk-clear" for user "admin-1"
* Opening Desk channel "channel-desk-bulk-clear" for user "admin-1"
* Selecting Desk ticket "ticket-desk-bulk-a" in the list for user "admin-1"
* verifying "input[placeholder='Priority']" is visible
* clicking on "[aria-label='Clear selection']"
* verifying "input[placeholder='Priority']" is not visible
