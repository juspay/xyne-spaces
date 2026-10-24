-- AlterTable
ALTER TABLE "public"."delayed_messages" ADD COLUMN     "pollDraft" JSONB;

-- CreateTable
CREATE TABLE "public"."polls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "allowAudienceChoices" BOOLEAN NOT NULL DEFAULT false,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "resultVisibility" TEXT NOT NULL DEFAULT 'EVERYONE',
    "closesAt" TIMESTAMP(3),
    "remindAt" TIMESTAMP(3),
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
    "options" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_questions_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "public"."poll_question_results" (
    "questionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "voterCount" INTEGER NOT NULL DEFAULT 0,
    "optionCounts" JSONB NOT NULL DEFAULT '{}',
    "rankTotals" JSONB NOT NULL DEFAULT '{}',
    "ratingTotal" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poll_question_results_pkey" PRIMARY KEY ("questionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "polls_messageId_key" ON "public"."polls"("messageId");

-- CreateIndex
CREATE INDEX "polls_workspaceId_idx" ON "public"."polls"("workspaceId");

-- CreateIndex
CREATE INDEX "polls_createdBy_idx" ON "public"."polls"("createdBy");

-- CreateIndex
CREATE INDEX "poll_questions_workspaceId_idx" ON "public"."poll_questions"("workspaceId");

-- CreateIndex
CREATE INDEX "poll_questions_pollId_idx" ON "public"."poll_questions"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_questions_pollId_position_key" ON "public"."poll_questions"("pollId", "position");

-- CreateIndex
CREATE INDEX "poll_votes_workspaceId_idx" ON "public"."poll_votes"("workspaceId");

-- CreateIndex
CREATE INDEX "poll_votes_pollId_idx" ON "public"."poll_votes"("pollId");

-- CreateIndex
CREATE INDEX "poll_votes_userId_idx" ON "public"."poll_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_questionId_userId_key" ON "public"."poll_votes"("questionId", "userId");

-- CreateIndex
CREATE INDEX "poll_question_results_workspaceId_idx" ON "public"."poll_question_results"("workspaceId");

-- CreateIndex
CREATE INDEX "poll_question_results_pollId_idx" ON "public"."poll_question_results"("pollId");

