-- Cold-start fairness: one-time offset added to a brand-new member's weightedActiveTasks
-- so they score at parity with established peers instead of flooding from 0.
ALTER TABLE "public"."user_group_mappings" ADD COLUMN "startOffset" INTEGER NULL;

-- Max weighted workload per member: Σ(tickets × board weight). NULL = unlimited.
-- A member at or above this value is skipped for auto-assignment; if every
-- candidate is at the cap, no assignment is made.
ALTER TABLE "public"."user_groups" ADD COLUMN "maxWorkload" INTEGER NULL;
