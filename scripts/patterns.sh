#!/bin/bash

# Ignored file patterns - files matching these won't trigger service detection
IGNORE_PATTERNS=(
    ".md"
    ".png"
    ".jpg"
    ".jpeg"
    ".svg"
    ".gif"
    ".test.ts"
    ".test.tsx"
    ".spec.ts"
    ".spec.tsx"
    ".lock"
    "package-lock.json"
    "yarn.lock"
    ".gitignore"
    ".eslintrc*"
    ".prettierrc*"
    "docs/"
    "README.md"
    "CHANGELOG.md"
)

# Migration patterns - files matching these require migration justification
MIGRATION_PATTERNS=(
    "backend/prisma/migrations/"
    "backend/prisma/schema.prisma"
)

# Environment patterns - files matching these require env justification
ENV_PATTERNS=(
    "env.ts"
    ".env"
    ".env.local"
    ".env.example"
)

# Service mappings - format: "path_prefix:service_name"
# Order matters! More specific patterns should come first
SERVICE_MAPPINGS=(
    "backend/python-agent/:xyne-transcription-agent"
    "backend/src/workflows/:runner"
    "backend/src/:backend"
    "backend/prisma/:backend"
    "backend/package.json:backend"
    "ysweet/:ysweet"
    "dashboard/src/:dashboard"
    "dashboard/package.json:dashboard"
    "shared/:backend"
    "shared/:dashboard"
)