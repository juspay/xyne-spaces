ALTER TABLE "users"
  ADD COLUMN "digitalTwinMemoryApprovalMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "digitalTwinMemoryAutoApproveMinScore" DOUBLE PRECISION NOT NULL DEFAULT 0.9;
