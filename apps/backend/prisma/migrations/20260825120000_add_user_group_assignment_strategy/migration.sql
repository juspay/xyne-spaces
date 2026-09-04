-- AlterTable
ALTER TABLE "public"."user_groups" ADD COLUMN     "assignmentStrategy" TEXT NOT NULL DEFAULT 'WORKLOAD';

-- AlterTable
ALTER TABLE "public"."user_assignment_states" ADD COLUMN     "lastAssignedAt" TIMESTAMP(3);

-- Round-robin picks the least-recently-assigned eligible member; this index keeps
-- that ordering cheap per group.
CREATE INDEX "user_assignment_states_userGroupId_lastAssignedAt_idx" ON "public"."user_assignment_states"("userGroupId", "lastAssignedAt");
