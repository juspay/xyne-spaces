-- Apps: internal vs external dispatch routing.
-- INTERNAL apps dispatch to an in-cluster pod URL; EXTERNAL apps go through the SSRF guard.
-- Plain TEXT (DB enums are frozen); values enforced app-side via the AppType enum.
ALTER TABLE "public"."apps" ADD COLUMN "appType" TEXT NOT NULL DEFAULT 'EXTERNAL';

CREATE INDEX "apps_appType_idx" ON "public"."apps"("appType");
