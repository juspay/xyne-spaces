# Xyne Desk inbound email
> Customer email delivered to a Desk mailbox runs through Gmail ingestion and becomes a ticket.

## Customer email to a Desk mailbox becomes a ticket in that channel
* Setting up Desk channel "channel-desk-inbound" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-inbound" in channel "channel-desk-inbound" for user "admin-1"
* Opening Desk ticket "ticket-desk-inbound" in channel "channel-desk-inbound" for user "admin-1"
* Verifying open Desk ticket "ticket-desk-inbound" shows its customer email for user "admin-1"

## Emails to two Desk mailboxes land only in their own channel
* Setting up Desk channel "channel-desk-routing-a" for user "admin-1"
* ensuring Desk channel "channel-desk-routing-b" exists in fixture for user "admin-1" in project "project-1"
* Receiving Desk email ticket "ticket-desk-routing-a" in channel "channel-desk-routing-a" for user "admin-1"
* Receiving Desk email ticket "ticket-desk-routing-b" in channel "channel-desk-routing-b" for user "admin-1"
* Verifying Desk channel "channel-desk-routing-a" lists "ticket-desk-routing-a" but not "ticket-desk-routing-b" for user "admin-1"
* Verifying Desk channel "channel-desk-routing-b" lists "ticket-desk-routing-b" but not "ticket-desk-routing-a" for user "admin-1"
