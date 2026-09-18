-- Per-user credentials for reaching an external hostname with `webfetch`.
CREATE TABLE "user_host_credentials" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "host"          TEXT NOT NULL,
  "scheme"        TEXT NOT NULL DEFAULT 'bearer',
  "headerName"    TEXT,
  "encryptedCred" TEXT NOT NULL,
  "iv"            TEXT NOT NULL,
  "authTag"       TEXT NOT NULL,
  "agentSlugs"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "label"         TEXT,
  "expiresAt"     TIMESTAMP(3),
  "lastUsedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_host_credentials_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "user_host_credentials"
  ADD CONSTRAINT "user_host_credentials_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "user_host_credentials_userId_host_key" ON "user_host_credentials"("userId", "host");
CREATE INDEX "user_host_credentials_userId_idx" ON "user_host_credentials"("userId");

-- OAuth clients registered on the fly (RFC 7591) for hosts that support
-- sign-in, cached with the discovery result that produced them. Shared across
-- users: every column comes from metadata the host itself publishes, and
-- registering per user would pile up clients on somebody else's server.
CREATE TABLE "host_oauth_clients" (
  "id"                    TEXT NOT NULL,
  "host"                  TEXT NOT NULL,
  "issuer"                TEXT NOT NULL,
  "issuerHost"            TEXT NOT NULL,
  "authorizationEndpoint" TEXT NOT NULL,
  "tokenEndpoint"         TEXT NOT NULL,
  "registrationEndpoint"  TEXT NOT NULL,
  "revocationEndpoint"    TEXT,
  "resource"              TEXT,
  "scope"                 TEXT,
  "clientId"              TEXT NOT NULL,
  "encryptedSecret"       TEXT,
  "iv"                    TEXT,
  "authTag"               TEXT,
  "redirectUri"           TEXT NOT NULL,
  "discoveredAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "host_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "host_oauth_clients_host_key" ON "host_oauth_clients"("host");
CREATE INDEX "host_oauth_clients_issuerHost_idx" ON "host_oauth_clients"("issuerHost");
