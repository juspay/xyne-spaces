-- CreateTable
CREATE TABLE "non_zero"."org_member_credentials" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_member_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_member_credentials_memberId_key" ON "non_zero"."org_member_credentials"("memberId");
