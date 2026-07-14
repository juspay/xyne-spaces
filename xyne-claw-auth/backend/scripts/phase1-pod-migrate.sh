#!/usr/bin/env bash
#
# phase1-pod-migrate.sh — Phase-1 org-only foundation: apply schema + migrate
# current users into the default "Juspay" org. Safe to run inside a claw-auth
# pod (it already has DATABASE_URL, node_modules, and `tsx`). IDEMPOTENT —
# re-running is a no-op once every user has an orgId.
#
# What it does:
#   1. prisma migrate deploy   → creates organizations / org_members, adds
#                                users.orgId (NULLABLE). No data loss; does NOT
#                                touch users.id or the email unique index.
#   2. prisma generate         → refresh the client (no-op if already current).
#   3. backfill-default-org.ts → create/reuse the "Juspay" org and set
#                                users.orgId + an OrgMember row for EVERY user.
#                                DEFAULT_ADMIN_EMAIL (if set) becomes OWNER.
#
# It does NOT flip users.orgId to NOT NULL — that is a separate follow-up
# migration you ship only after this reports 0 remaining nulls.
#
# Usage (inside the pod):
#   DEFAULT_ADMIN_EMAIL=john.doe@gmail.com bash scripts/phase1-pod-migrate.sh
#
set -euo pipefail

# Resolve to the backend root regardless of where we're invoked from.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[phase1] backend root: $(pwd)"

: "${DATABASE_URL:?DATABASE_URL must be set in the environment}"
ADMIN_EMAIL="${DEFAULT_ADMIN_EMAIL:-}"
[ -n "$ADMIN_EMAIL" ] && echo "[phase1] OWNER will be: $ADMIN_EMAIL" \
                       || echo "[phase1] WARNING: DEFAULT_ADMIN_EMAIL unset — no OWNER promoted."

# ── 1. Schema migration ────────────────────────────────────────────────────
# Needs the prisma CLI. It is a devDependency, so if the prod image pruned
# devDeps this step fails — in that case run `prisma migrate deploy` from CI or
# a machine with the repo against the same DATABASE_URL, then re-run this
# script (it will skip to the backfill).
echo "[phase1] 1/3 prisma migrate deploy…"
if npx --no-install prisma -v >/dev/null 2>&1; then
  npx --no-install prisma migrate deploy
else
  echo "[phase1] ERROR: prisma CLI not present in this image." >&2
  echo "[phase1]        Apply the schema migration elsewhere (CI/local) with:" >&2
  echo "[phase1]          npx prisma migrate deploy   # against prod DATABASE_URL" >&2
  echo "[phase1]        then re-run this script to do the user backfill." >&2
  exit 3
fi

# ── 2. Client (safe no-op if already generated into the image) ─────────────
echo "[phase1] 2/3 prisma generate…"
npx --no-install prisma generate >/dev/null 2>&1 || echo "[phase1] (generate skipped — client already built into image)"

# ── 3. Backfill current users → Juspay ─────────────────────────────────────
echo "[phase1] 3/3 backfill users into the Juspay org…"
DEFAULT_ADMIN_EMAIL="$ADMIN_EMAIL" npx --no-install tsx scripts/backfill-default-org.ts

echo "[phase1] Done. If the backfill reported 0 remaining nulls, you can ship the"
echo "[phase1] follow-up migration that flips users.orgId to NOT NULL."
