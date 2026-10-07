-- CreateTable
CREATE TABLE "non_zero"."org_member_credentials" (
    "memberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_member_credentials_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "org_member_credentials_orgId_idx" ON "non_zero"."org_member_credentials"("orgId");
