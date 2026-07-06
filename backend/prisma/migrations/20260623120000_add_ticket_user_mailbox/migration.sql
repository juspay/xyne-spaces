-- Prisma model: TicketUserMailbox ("ticket_user_mailbox") + enum MailboxState.
-- Gmail-style mailbox overlay: a per-user, per-desk filing (Inbox/Archived/Spam/Trash + star)
-- of a shared ticket. Sparse — a row exists only once the agent acts; absence = { INBOX, not
-- starred }. The ticket stays shared at the channel level.

-- CreateEnum
CREATE TYPE "public"."MailboxState" AS ENUM ('INBOX', 'ARCHIVED', 'SPAM');

-- CreateTable
CREATE TABLE "public"."ticket_user_mailbox" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "state" "public"."MailboxState",
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-06-30T08:55:30.101491Z',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_user_mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One overlay row per agent per ticket; also serves the setState/setStarred upsert
-- lookup and the tickets.userMailbox correlation (spam/starred exists() + related()).
CREATE UNIQUE INDEX "ticket_user_mailbox_ticketId_userId_key" ON "public"."ticket_user_mailbox"("ticketId", "userId");
