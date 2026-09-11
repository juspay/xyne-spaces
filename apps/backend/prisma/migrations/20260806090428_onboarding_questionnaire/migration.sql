-- CreateTable
CREATE TABLE "non_zero"."questionnaire_responses" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionnaireType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_workspaceId_questionnaireType_userId_key" ON "non_zero"."questionnaire_responses"("workspaceId", "questionnaireType", "userId");
