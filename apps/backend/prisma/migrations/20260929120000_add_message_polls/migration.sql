SET lock_timeout = '10s';

-- CreateTable
CREATE TABLE "public"."polls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "allowAudienceChoices" BOOLEAN NOT NULL DEFAULT false,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "resultVisibility" TEXT NOT NULL DEFAULT 'EVERYONE',
    "sortResultsByVotes" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
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
    "responseType" TEXT NOT NULL DEFAULT 'SINGLE_CHOICE',
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
    "textAnswer" TEXT,
    "rankedOptionIds" JSONB,
    "rating" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- Identity-free aggregates replicated to poll participants. Raw ballot rows are
-- readable only by their voter or by the author of a non-anonymous poll.
CREATE TABLE "public"."poll_question_results" (
    "questionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "voterCount" INTEGER NOT NULL DEFAULT 0,
    "optionCounts" JSONB NOT NULL DEFAULT '{}',
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "rankTotals" JSONB NOT NULL DEFAULT '{}',
    "rankResponseCount" INTEGER NOT NULL DEFAULT 0,
    "ratingCounts" JSONB NOT NULL DEFAULT '{}',
    "ratingTotal" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_question_results_pkey" PRIMARY KEY ("questionId")
);

ALTER TABLE "public"."delayed_messages"
ADD COLUMN "pollDraft" JSONB;

CREATE TABLE "public"."poll_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "poll_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."poll_reminder_deliveries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollJobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "poll_reminder_deliveries_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "poll_question_results_workspaceId_idx" ON "public"."poll_question_results"("workspaceId");
CREATE INDEX "poll_question_results_pollId_idx" ON "public"."poll_question_results"("pollId");
CREATE UNIQUE INDEX "poll_jobs_pollId_kind_key" ON "public"."poll_jobs"("pollId", "kind");
CREATE INDEX "poll_jobs_workspaceId_status_runAt_idx" ON "public"."poll_jobs"("workspaceId", "status", "runAt");
CREATE INDEX "poll_jobs_status_runAt_leaseExpiresAt_idx" ON "public"."poll_jobs"("status", "runAt", "leaseExpiresAt");
CREATE INDEX "poll_jobs_pollId_idx" ON "public"."poll_jobs"("pollId");
CREATE UNIQUE INDEX "poll_reminder_deliveries_pollJobId_userId_key" ON "public"."poll_reminder_deliveries"("pollJobId", "userId");
CREATE INDEX "poll_reminder_deliveries_workspaceId_status_idx" ON "public"."poll_reminder_deliveries"("workspaceId", "status");

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

ALTER TABLE "public"."poll_question_results"
ADD CONSTRAINT "poll_question_results_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "public"."polls"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_question_results"
ADD CONSTRAINT "poll_question_results_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "public"."poll_questions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_jobs"
ADD CONSTRAINT "poll_jobs_pollId_fkey"
FOREIGN KEY ("pollId") REFERENCES "public"."polls"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."poll_reminder_deliveries"
ADD CONSTRAINT "poll_reminder_deliveries_pollJobId_fkey"
FOREIGN KEY ("pollJobId") REFERENCES "public"."poll_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Recompute from ballot source-of-truth so concurrent voters cannot lose count
-- updates. This trigger must be installed by migrations; prisma db push cannot
-- express PostgreSQL triggers.
CREATE OR REPLACE FUNCTION "public"."refresh_poll_question_result"()
RETURNS TRIGGER AS $$
DECLARE
    affected_question_id TEXT;
BEGIN
    affected_question_id := COALESCE(NEW."questionId", OLD."questionId");
    PERFORM pg_advisory_xact_lock(hashtextextended(affected_question_id, 0));

    INSERT INTO "public"."poll_question_results" (
        "questionId",
        "workspaceId",
        "pollId",
        "voterCount",
        "optionCounts", "responseCount", "rankTotals", "rankResponseCount",
        "ratingCounts", "ratingTotal",
        "updatedAt"
    )
    SELECT
        question."id",
        question."workspaceId",
        question."pollId",
        (SELECT COUNT(*)::INTEGER
           FROM "public"."poll_votes" AS ballot
          WHERE ballot."questionId" = question."id"),
        COALESCE((
            SELECT jsonb_object_agg(option_vote."optionId", option_vote."voteCount")
              FROM (
                  SELECT selected."optionId", COUNT(*)::INTEGER AS "voteCount"
                    FROM "public"."poll_votes" AS ballot
                    CROSS JOIN LATERAL jsonb_array_elements_text(ballot."optionIds")
                        AS selected("optionId")
                   WHERE ballot."questionId" = question."id"
                   GROUP BY selected."optionId"
              ) AS option_vote
        ), '{}'::jsonb),
        (SELECT COUNT(*)::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"),
        COALESCE((
            SELECT jsonb_object_agg(ranked."optionId", ranked."rankTotal")
              FROM (
                  SELECT ranking."optionId", SUM(ranking.ordinality)::INTEGER AS "rankTotal"
                    FROM "public"."poll_votes" AS ballot
                    CROSS JOIN LATERAL jsonb_array_elements_text(ballot."rankedOptionIds")
                      WITH ORDINALITY AS ranking("optionId", ordinality)
                   WHERE ballot."questionId" = question."id"
                     AND ballot."rankedOptionIds" IS NOT NULL
                   GROUP BY ranking."optionId"
              ) AS ranked
        ), '{}'::jsonb),
        (SELECT COUNT(*)::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"
            AND response."rankedOptionIds" IS NOT NULL),
        COALESCE((
            SELECT jsonb_object_agg(rated."rating", rated."ratingCount")
              FROM (
                  SELECT response."rating", COUNT(*)::INTEGER AS "ratingCount"
                    FROM "public"."poll_votes" AS response
                   WHERE response."questionId" = question."id"
                     AND response."rating" IS NOT NULL
                   GROUP BY response."rating"
              ) AS rated
        ), '{}'::jsonb),
        COALESCE((SELECT SUM(response."rating")::INTEGER FROM "public"."poll_votes" AS response
          WHERE response."questionId" = question."id"), 0),
        CURRENT_TIMESTAMP
      FROM "public"."poll_questions" AS question
     WHERE question."id" = affected_question_id
    ON CONFLICT ("questionId") DO UPDATE SET
        "voterCount" = EXCLUDED."voterCount",
        "optionCounts" = EXCLUDED."optionCounts",
        "responseCount" = EXCLUDED."responseCount",
        "rankTotals" = EXCLUDED."rankTotals",
        "rankResponseCount" = EXCLUDED."rankResponseCount",
        "ratingCounts" = EXCLUDED."ratingCounts",
        "ratingTotal" = EXCLUDED."ratingTotal",
        "updatedAt" = EXCLUDED."updatedAt";

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "poll_votes_refresh_question_result"
AFTER INSERT OR UPDATE OR DELETE ON "public"."poll_votes"
FOR EACH ROW
EXECUTE FUNCTION "public"."refresh_poll_question_result"();

RESET lock_timeout;
