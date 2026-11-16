import type {} from '@xyne/workflow-sdk';
export type XyneCtx = {
  userId: string;
  workspaceId: string;
};

export type XyneFilter = {
  workspaceId: string;
  /** Credentials only: the caller, who sees the credentials they own. */
  ownerId?: string;
};

export type XyneResourceAttrs = {
  workspaceId: string;
  createdByUserId?: string;
  /** Workflow records: the workflow's own id. */
  workflowId?: string;
  /** Credential records: the member who owns the credential. */
  ownerId?: string;
};

declare module '@xyne/workflow-sdk' {
  interface Register {
    attributes: {
      workflow: XyneResourceAttrs;
      folder: XyneResourceAttrs;
      credential: XyneResourceAttrs;
    };
    authContext: XyneCtx;
  }
}
