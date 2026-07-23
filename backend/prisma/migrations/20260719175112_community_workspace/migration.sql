-- AlterEnum
ALTER TYPE "public"."OrgRole" ADD VALUE 'COMMUNITY_MEMBER';

-- AlterEnum
ALTER TYPE "public"."WorkspaceRole" ADD VALUE 'COMMUNITY_MEMBER';

-- AlterTable
ALTER TABLE "public"."workspaces" ADD COLUMN     "joinPolicy" TEXT,
ADD COLUMN     "landingChannelId" TEXT,
ADD COLUMN     "workspaceType" TEXT;

-- CreateTable
CREATE TABLE "non_zero"."organization_domains" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."workspace_join_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."ai_provisioning_status" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT,
    "lastAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provisioning_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."org_llm_service_account_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastProvisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_llm_service_account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_domains_orgId_idx" ON "non_zero"."organization_domains"("orgId");

-- CreateIndex
CREATE INDEX "organization_domains_domain_verificationStatus_idx" ON "non_zero"."organization_domains"("domain", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "organization_domains_orgId_domain_key" ON "non_zero"."organization_domains"("orgId", "domain");

-- CreateIndex
CREATE INDEX "workspace_join_requests_workspaceId_email_updatedAt_idx" ON "non_zero"."workspace_join_requests"("workspaceId", "email", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "workspace_join_requests_email_status_updatedAt_idx" ON "non_zero"."workspace_join_requests"("email", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "workspace_join_requests_workspaceId_status_createdAt_idx" ON "non_zero"."workspace_join_requests"("workspaceId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_provisioning_status_status_updatedAt_idx" ON "non_zero"."ai_provisioning_status"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provisioning_status_subjectType_subjectId_provider_key" ON "non_zero"."ai_provisioning_status"("subjectType", "subjectId", "provider");

-- CreateIndex
CREATE INDEX "org_llm_service_account_credentials_orgId_status_idx" ON "non_zero"."org_llm_service_account_credentials"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_llm_service_account_credentials_orgId_provider_purpose_key" ON "non_zero"."org_llm_service_account_credentials"("orgId", "provider", "purpose");
