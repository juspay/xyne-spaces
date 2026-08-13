-- Add nullable email for person-level onboarding responses while keeping
-- workspace/user-scoped questionnaire responses intact.
ALTER TABLE "non_zero"."questionnaire_responses"
ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "questionnaire_responses_questionnaireType_email_key"
ON "non_zero"."questionnaire_responses"("questionnaireType", "email");
