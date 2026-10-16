export type SosAlert = {
  id: string;
  /** Trusted local owner attached when the alert enters app-owned storage. */
  ownerUserId?: string;
  title: string;
  body: string;
  actionUrl?: string;
  workspaceId?: string;
  receivedAt: number;
  rawData: Record<string, string>;
};
