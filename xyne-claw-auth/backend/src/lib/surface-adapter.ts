import type { IncomingHttpHeaders } from "node:http";
import { slackSurfaceAdapter } from "./adapters/slack-surface.js";

export interface NormalizedInboundEvent {
  eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
  surfaceTenantId: string;
  surfaceUserId: string;
  channelId: string;
  threadId?: string;
  text: string;
  eventId: string;
  raw: unknown;
}

export interface SurfaceMessage {
  channelId: string;
  threadId?: string;
  text: string;
  raw?: unknown;
}

export interface PostedRef {
  channelId: string;
  messageId: string;
  threadId?: string;
  raw?: unknown;
}

export interface SurfaceAdapter {
  readonly key: string;
  verifySignature(rawBody: Buffer | string, headers: IncomingHttpHeaders, secret: string): boolean;
  parseInbound(payload: unknown): NormalizedInboundEvent | null;
  formatReply?(message: SurfaceMessage): unknown;
  resolveMentions?(message: SurfaceMessage): SurfaceMessage | Promise<SurfaceMessage>;
  postMessage?(message: SurfaceMessage): Promise<PostedRef>;
}

const adapters = new Map<string, SurfaceAdapter>([
  [slackSurfaceAdapter.key, slackSurfaceAdapter],
]);

export function getSurfaceAdapter(key: string): SurfaceAdapter | undefined {
  return adapters.get(key);
}
