-- CreateTable
CREATE TABLE "public"."polls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "allowComments" BOOLEAN NOT NULL DEFAULT true,
    "allowMultipleVotes" BOOLEAN NOT NULL DEFAULT false,
    "allowAudienceChoices" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."poll_questions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."poll_options" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."poll_votes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "polls_messageId_key" ON "public"."polls"("messageId");
CREATE INDEX "polls_workspaceId_idx" ON "public"."polls"("workspaceId");
CREATE INDEX "polls_createdBy_idx" ON "public"."polls"("createdBy");

CREATE UNIQUE INDEX "poll_questions_pollId_position_key" ON "public"."poll_questions"("pollId", "position");
CREATE INDEX "poll_questions_workspaceId_idx" ON "public"."poll_questions"("workspaceId");
CREATE INDEX "poll_questions_pollId_idx" ON "public"."poll_questions"("pollId");

CREATE UNIQUE INDEX "poll_options_questionId_normalizedText_key" ON "public"."poll_options"("questionId", "normalizedText");
CREATE INDEX "poll_options_workspaceId_idx" ON "public"."poll_options"("workspaceId");
CREATE INDEX "poll_options_questionId_position_createdAt_idx" ON "public"."poll_options"("questionId", "position", "createdAt");

CREATE UNIQUE INDEX "poll_votes_questionId_userId_key" ON "public"."poll_votes"("questionId", "userId");
CREATE INDEX "poll_votes_workspaceId_idx" ON "public"."poll_votes"("workspaceId");
CREATE INDEX "poll_votes_pollId_idx" ON "public"."poll_votes"("pollId");
CREATE INDEX "poll_votes_userId_idx" ON "public"."poll_votes"("userId");

-- AddForeignKey
ALTER TABLE "public"."polls"
ADD CONSTRAINT "polls_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "public"."messages"("messageId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_questions"
ADD CONSTRAINT "poll_questions_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "public"."polls"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_options"
ADD CONSTRAINT "poll_options_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "public"."poll_questions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_votes"
ADD CONSTRAINT "poll_votes_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "public"."polls"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_votes"
ADD CONSTRAINT "poll_votes_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "public"."poll_questions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce allowComments for every message writer, including bots, APIs and
-- direct Prisma inserts that do not pass through the Zero messages.send mutator.
CREATE OR REPLACE FUNCTION "public"."reject_disabled_poll_comments"()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "public"."conversations" AS conversation
        INNER JOIN "public"."polls" AS poll
            ON poll."messageId" = conversation."initialMessageId"
        WHERE conversation."conversationId" = NEW."conversationId"
          AND poll."allowComments" = false
    ) THEN
        RAISE EXCEPTION 'Comments are disabled for this poll'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_reject_disabled_poll_comments"
BEFORE INSERT ON "public"."messages"
FOR EACH ROW
EXECUTE FUNCTION "public"."reject_disabled_poll_comments"();
