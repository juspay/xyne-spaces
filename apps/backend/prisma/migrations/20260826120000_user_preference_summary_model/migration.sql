-- AlterTable
-- Per-user recording summary LLM model tier: "fast" (default) or "thinking"; null treated as "fast".
ALTER TABLE "public"."user_preferences" ADD COLUMN "summaryModelPreference" TEXT DEFAULT 'fast';
