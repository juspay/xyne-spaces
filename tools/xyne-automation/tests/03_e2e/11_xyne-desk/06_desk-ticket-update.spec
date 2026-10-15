# Xyne Desk ticket update
> An agent changes a Desk ticket's priority and status from the ticket header; the change persists and the Desk filters find the ticket by its new values.

## Agent updates ticket priority and status, and the filters find it
* Setting up Desk channel "channel-desk-ticket-update" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-update" in channel "channel-desk-ticket-update" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-untouched" in channel "channel-desk-ticket-update" for user "admin-1"
* Opening Desk ticket "ticket-desk-update" in channel "channel-desk-ticket-update" for user "admin-1"
* Changing open Desk ticket priority to "High" and status to "In Progress"
* waiting for zero sync to settle
* Opening Desk ticket "ticket-desk-update" in channel "channel-desk-ticket-update" for user "admin-1"
* waiting for text "High" to appear in "[aria-label='Change priority']"
* waiting for text "In Progress" to appear in "[aria-label='Change stage']"
* Opening Desk channel "channel-desk-ticket-update" for user "admin-1"
* Filtering Desk tickets by priority "High"
* verifying stored user "admin-1" ticket "ticket-desk-update" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-untouched" field "title" is not visible in "[data-testid='support-page']"
* Clearing Desk filters
* Filtering Desk tickets by status "In Progress"
* verifying stored user "admin-1" ticket "ticket-desk-update" field "title" is visible in "[data-testid='support-page']"
* verifying stored user "admin-1" ticket "ticket-desk-untouched" field "title" is not visible in "[data-testid='support-page']"
