// Shared types for the @xyne/workflow-sdk integration, plus the Register
// augmentation that types the SDK's opaque `attributes` to xyne-spaces' shape.

import type {} from '@xyne/workflow-sdk';

/**
 * Discriminator on the legacy tables the SDK shares. EVERY SDK read/write
 * filters on it, or it would see automation rows. It lives here rather than in
 * persistence.ts because resourcePermissions.ts needs it and persistence.ts
 * imports that module — a shared home avoids the cycle.
 */
export const SDK_WORKFLOW_TYPE = 'SDK';

/** The list predicate the adapter receives from `visibleFilter`. */
export type XyneFilter = {
  userId: string;
  workspaceId: string;
};

/** Who is asking. `isAdmin` is the WORKFLOW-STUDIO ACL grant, resolved once per
 *  request by accessControl.ts and read only by the authorizer. */
export type XyneCtx = XyneFilter & {
  isAdmin: boolean;
};

/**
 * Derived from columns on read, not stored as a blob — so the create-time and
 * read-time shapes differ. `createdByUserId` is set from ctx at CREATE only and
 * consumed to stamp the owner permission row, never persisted. `isPublic` and
 * `createdBy` are reconstructed on READ; neither is read under the current flat
 * policy, both are carried for the per-resource phase.
 */
export type XyneResourceAttrs = {
  workspaceId: string;
  createdByUserId?: string;
  isPublic?: boolean;
  createdBy?: string | null;
};

declare module '@xyne/workflow-sdk' {
  interface Register {
    attributes: {
      workflow: XyneResourceAttrs;
      folder: XyneResourceAttrs;
      credential: XyneResourceAttrs;
    };
  }
}
