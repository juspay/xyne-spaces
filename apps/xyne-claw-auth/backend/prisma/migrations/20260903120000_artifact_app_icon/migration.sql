-- The app's icon: a Xyne icon id chosen by the agent on the first build and
-- editable by the owner afterwards. Nullable — every existing app has none
-- and renders its fallback mark until one is set. App-level rather than
-- per-version: the icon identifies the APP wherever it is listed, and a user's
-- choice must survive every later build.
ALTER TABLE "artifact_apps" ADD COLUMN "icon" TEXT;
