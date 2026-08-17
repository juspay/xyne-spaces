-- Cold-start fairness: one-time offset added to a brand-new member's weightedActiveTasks
-- so they score at parity with established peers instead of flooding from 0.
ALTER TABLE "public"."user_group_mappings"
  ADD COLUMN "startOffset" INTEGER NULL;
