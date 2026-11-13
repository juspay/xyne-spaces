import type {} from '@xyne/workflow-sdk';
export type XyneCtx = {
  userId: string;
  workspaceId: string;
};

export type XyneFilter = {
  workspaceId: string;
};

export type XyneResourceAttrs = {
  workspaceId: string;
  createdByUserId?: string;
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
