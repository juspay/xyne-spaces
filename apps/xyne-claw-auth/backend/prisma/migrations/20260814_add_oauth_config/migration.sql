-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "isOauth" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oauthConfig" JSONB;
