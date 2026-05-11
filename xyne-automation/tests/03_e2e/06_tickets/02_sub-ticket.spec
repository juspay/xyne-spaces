# Sub-Ticket Creation E2E Flow
> Create sub-tickets under a parent ticket — covering single sub-ticket and the multi-sub-ticket-with-attachment flow.

## Admin creates a sub-ticket under a parent ticket
* Setting up sub-ticket test with parent ticket "ticket-parent-1" for admin "admin-1"
* Updating ticket "ticket-parent-1" status to "In Progress" and priority to "Critical" for user "admin-1"
* waiting for zero sync to settle
* Creating sub-ticket "ticket-sub-1" for user "admin-1" with priority "Medium"

## Admin creates two sub-tickets including one with attachment
* Setting up sub-ticket test with parent ticket "ticket-parent-2" for admin "admin-1"
* Updating ticket "ticket-parent-2" status to "In Progress" and priority to "Critical" for user "admin-1"
* waiting for zero sync to settle
* Creating sub-ticket "ticket-sub-2" for user "admin-1" with priority "Medium"
* Creating sub-ticket "ticket-sub-3" with attachment for user "admin-1" with priority "High" and assignee "user-2"
