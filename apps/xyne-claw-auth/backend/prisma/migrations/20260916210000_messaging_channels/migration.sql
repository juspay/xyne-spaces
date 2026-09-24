-- Messaging channels: talk to a Claw agent from a consumer messenger.
--
-- An account is an existing `connected_surfaces` row (surfaceTenantId
-- 'acct_…') plus a `surface_agents` row for its default agent, and a sender's
-- link to a Claw user is an ordinary `user_surface_identities` row — the same
-- table Slack uses. So the only new table is the one below.

-- Everything a plugin needs to authenticate as one account.
--
-- For the Cloud API that is four bearer values. For Baileys it is the Signal
-- protocol's AuthenticationState: a creds document plus its pre-key, session
-- and sender-key entries, which are rewritten continuously while the socket is
-- open. Hence one row per key — in a JSON column each of those writes would
-- rewrite the whole account config, and `updateAccountConfig` merges that same
-- column without a lock, so a connection-state patch would silently drop keys
-- written while it was in flight. Every value is AES-GCM encrypted.
CREATE TABLE "channel_auth_state" (
    "id" TEXT NOT NULL,
    "connectedSurfaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT '',
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_auth_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_auth_state_connectedSurfaceId_category_keyId_key"
  ON "channel_auth_state"("connectedSurfaceId", "category", "keyId");

CREATE INDEX "channel_auth_state_connectedSurfaceId_idx"
  ON "channel_auth_state"("connectedSurfaceId");

ALTER TABLE "channel_auth_state" ADD CONSTRAINT "channel_auth_state_connectedSurfaceId_fkey"
  FOREIGN KEY ("connectedSurfaceId") REFERENCES "connected_surfaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A channel account has exactly ONE default agent. The partial predicate
-- leaves Slack's org-level ('' tenant) and per-workspace bindings alone.
CREATE UNIQUE INDEX "surface_agents_one_default_per_channel_account"
  ON "surface_agents" ("surfaceId", "surfaceTenantId")
  WHERE "surfaceTenantId" LIKE 'acct\_%';

-- Two transports for the same messenger, registered as separate surfaces.
--
-- 'whatsapp'       Baileys, a linked device on an ordinary number. Reaches
--                  anyone, does groups, and belongs to one person.
-- 'whatsapp-cloud' the official Business API. One number for the whole org,
--                  no groups, replies limited to a 24-hour window.
INSERT INTO "surfaces" (
  "id", "key", "identityMode", "supportsUserResolution", "capabilities", "status", "createdAt", "updatedAt"
)
VALUES
  ('whatsapp', 'whatsapp', 'USER_ID', true,
   '{"transport":"connection","login":"qr","groups":true,"scope":"user"}'::jsonb,
   'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('whatsapp-cloud', 'whatsapp-cloud', 'USER_ID', true,
   '{"transport":"webhook","login":"token","groups":false,"scope":"org"}'::jsonb,
   'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "identityMode" = EXCLUDED."identityMode",
  "supportsUserResolution" = EXCLUDED."supportsUserResolution",
  "capabilities" = EXCLUDED."capabilities",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;
