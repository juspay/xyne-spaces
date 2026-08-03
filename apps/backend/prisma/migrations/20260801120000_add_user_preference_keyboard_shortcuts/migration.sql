-- AlterTable: per-user keyboard shortcut overrides (stringified JSON map, sparse)
ALTER TABLE "public"."user_preferences" ADD COLUMN "keyboardShortcuts" TEXT;
