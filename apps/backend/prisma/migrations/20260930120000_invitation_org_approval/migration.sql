-- null = flow skips the in-org check (read as approved), false = pending admin approval, true = approved
ALTER TABLE "public"."invitations" ADD COLUMN "isOrgApproved" BOOLEAN;

ALTER TABLE "public"."invitations" ADD COLUMN "inviteEmailSentAt" TIMESTAMP;

CREATE INDEX "invitations_orgId_isOrgApproved_idx" ON "public"."invitations"("orgId", "isOrgApproved");
