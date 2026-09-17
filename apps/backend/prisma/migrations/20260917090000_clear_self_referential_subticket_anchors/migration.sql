-- Data-only migration: clear conversation anchors that point at their own conversation.
--
-- Release sub-tickets are created with the release ticket's own conversationId
-- (one thread per release), so linkSubTicketConversationToParent[FromZero] used to
-- write an anchor onto that shared conversation naming the release ticket itself.
-- It rendered on the release ticket's own message as "sub-ticket of <that same
-- ticket>" (or "replied to a thread: <its own first message>" for rows written
-- before anchorType existed). Any update to the release ticket re-triggered it.
--
-- Both writers now bail when child and parent share a conversation; this clears the
-- anchors already written. A conversation can never be its own parent, so the only
-- predicate is self-reference — genuine anchors (parent conversation != own) are
-- left untouched whatever their anchorType.
UPDATE "public"."conversations"
SET "parentMessageId" = NULL,
    "parent_message_md" = NULL
WHERE "parent_message_md" IS NOT NULL
  AND "parent_message_md" LIKE '%' || E'\nconversationId: ' || "conversationId" || E'\n%';
