-- null = flow skips the in-org check (read as approved), false = pending admin approval, true = approved
ALTER TABLE "invitations" ADD COLUMN "isOrgApproved" BOOLEAN;

CREATE INDEX "invitations_orgId_isOrgApproved_idx" ON "invitations"("orgId", "isOrgApproved");
