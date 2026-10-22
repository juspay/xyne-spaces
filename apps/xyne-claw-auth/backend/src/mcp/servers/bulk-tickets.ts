/**
 * Most tickets one spaces-create-bulk-tickets / spaces-update-bulk-tickets call
 * takes. Shared by the tool schemas, their handlers and the queue-time
 * validators, so an oversized batch is refused before an approval card exists
 * instead of failing after the user approves it.
 */
export const MAX_BULK_TICKETS = 100;
