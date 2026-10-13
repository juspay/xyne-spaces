-- Device-aware mobile notification routing (Slack-style)
-- WHEN_DESKTOP_INACTIVE: suppress mobile push while the user is active on desktop
ALTER TABLE "user_preferences" ADD COLUMN "mobileRoutingMode" TEXT NOT NULL DEFAULT 'WHEN_DESKTOP_INACTIVE';
ALTER TABLE "user_preferences" ADD COLUMN "desktopInactivityThresholdMinutes" INTEGER NOT NULL DEFAULT 5;
