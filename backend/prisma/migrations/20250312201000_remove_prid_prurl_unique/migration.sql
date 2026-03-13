-- Drop the unique constraint on prId and prUrl in the pull_requests table
ALTER TABLE "pull_requests" DROP CONSTRAINT IF EXISTS "pull_requests_prId_prUrl_key";
