import type { Application } from 'express';

// No-op in this (public) build. The internal overlay repo (xyne-spaces-private)
// ships a real implementation of this exact file — same path, same export —
// which overrides this stub during the Jenkins overlay merge
// (rsync -a --ignore-existing), since the private repo's copy already exists
// in that tree before the public source is rsynced in. In a standalone public
// build the routes below simply don't exist and their paths 404, which is the
// correct behavior for an open-source build that doesn't ship internal
// migration/backfill tooling.
export function registerPrivateBackfillRoutes(_app: Application): void {}
