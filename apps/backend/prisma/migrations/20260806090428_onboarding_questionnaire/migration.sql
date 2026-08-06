-- CreateTable
CREATE TABLE "non_zero"."questionnaire_responses" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionnaireType" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_workspaceId_userId_questionnaireType_key" ON "non_zero"."questionnaire_responses"("workspaceId", "userId", "questionnaireType");

-- CreateIndex
CREATE INDEX "questionnaire_responses_workspaceId_questionnaireType_idx" ON "non_zero"."questionnaire_responses"("workspaceId", "questionnaireType");

-- CreateIndex
CREATE INDEX "questionnaire_responses_userId_idx" ON "non_zero"."questionnaire_responses"("userId");
