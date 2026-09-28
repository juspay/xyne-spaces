import { createHash } from "node:crypto";
import type { ConversationArtifact } from "@prisma/client";
import { prisma } from "../db.js";
import { orgIdForSpacesUser } from "./users-jit.js";
import { createLogger } from "../logger.js";

const log = createLogger("conversation-artifacts");

export const ARTIFACT_KINDS = [
  "CANVAS",
  "REACT_APP",
  "DESIGN_HTML",
  "FILE",
  "DIFF",
  "PREVIEW",
  "SPEC",
  "LINK",
  "PAGE",
  "REVIEW_ROOM",
  "LESSON",
  "UPLOAD",
] as const;

export const ARTIFACT_REF_SERVICES = ["SPACES", "CLAW", "EXTERNAL"] as const;

export const ARTIFACT_STATUSES = ["ACTIVE", "STALE", "DELETED"] as const;

export type ConversationArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactRefService = (typeof ARTIFACT_REF_SERVICES)[number];
export type ConversationArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export function isArtifactKind(value: unknown): value is ConversationArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function isArtifactRefService(value: unknown): value is ArtifactRefService {
  return typeof value === "string" && (ARTIFACT_REF_SERVICES as readonly string[]).includes(value);
}

export function isArtifactStatus(value: unknown): value is ConversationArtifactStatus {
  return typeof value === "string" && (ARTIFACT_STATUSES as readonly string[]).includes(value);
}

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "msclkid",
  "ref_src",
]);

export const ARTIFACT_TITLE_MAX = 300;
export const ARTIFACT_REF_ID_MAX = 1000;
export const ARTIFACT_URL_MAX = 4000;

export function normalizeExternalUrl(url: string): string | null {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hash = "";
  const keep: [string, string][] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    keep.push([key, value]);
  }
  parsed.search = "";
  for (const [key, value] of keep) parsed.searchParams.append(key, value);
  return parsed.toString();
}

const PROVIDER_PATTERNS: { provider: string; test: (host: string, path: string) => boolean }[] = [
  { provider: "google_docs", test: (h, p) => (h === "docs.google.com" || h.endsWith(".docs.google.com")) && p.startsWith("/document") },
  { provider: "google_sheets", test: (h, p) => (h === "docs.google.com" || h.endsWith(".docs.google.com")) && p.startsWith("/spreadsheets") },
  { provider: "google_slides", test: (h, p) => (h === "docs.google.com" || h.endsWith(".docs.google.com")) && p.startsWith("/presentation") },
  { provider: "google_docs", test: (h, p) => (h === "docs.google.com" || h.endsWith(".docs.google.com")) && p.startsWith("/forms") },
  { provider: "google_drive", test: (h) => h === "drive.google.com" || h.endsWith(".drive.google.com") || h === "docs.google.com" || h.endsWith(".docs.google.com") },
  { provider: "pitch", test: (h) => h === "pitch.com" || h.endsWith(".pitch.com") },
  { provider: "figma", test: (h) => h === "figma.com" || h.endsWith(".figma.com") },
  { provider: "notion", test: (h) => h === "notion.so" || h.endsWith(".notion.so") || h.endsWith(".notion.site") },
  { provider: "github", test: (h) => h === "github.com" || h.endsWith(".github.com") },
  { provider: "jira", test: (h, p) => h.endsWith(".atlassian.net") && (p.startsWith("/browse") || p.includes("/jira/")) },
  { provider: "confluence", test: (h, p) => h.endsWith(".atlassian.net") && p.includes("/wiki") },
  { provider: "jira", test: (h) => h.endsWith(".atlassian.net") },
];

export function detectLinkProvider(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(typeof url === "string" ? url.trim() : "");
  } catch {
    return "other";
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  for (const entry of PROVIDER_PATTERNS) {
    if (entry.test(host, path)) return entry.provider;
  }
  return "other";
}

export interface RecordConversationArtifactInput {
  conversationId: string;
  messageId?: string | null;
  runId?: string | null;
  kind: ConversationArtifactKind;
  refService: ArtifactRefService;
  refId: string;
  url?: string | null;
  provider?: string | null;
  latestVersionRef?: string | null;
  title: string;
  createdByUserId: string;
  orgId?: string | null;
}

function definedOnly<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out as Partial<T>;
}

export async function recordConversationArtifact(
  input: RecordConversationArtifactInput,
): Promise<ConversationArtifact | null> {
  const conversationId = input.conversationId?.trim();
  const rawRefId = input.refId?.trim();
  if (!conversationId || !rawRefId || !input.createdByUserId) {
    log.warn(`skipped record: conversationId=${conversationId} refId=${rawRefId} kind=${input.kind}`);
    return null;
  }
  if (!isArtifactKind(input.kind) || !isArtifactRefService(input.refService)) {
    log.warn(`skipped record: bad kind=${input.kind} refService=${input.refService}`);
    return null;
  }

  let refId = rawRefId;
  let url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : null;
  if (refId.length > ARTIFACT_REF_ID_MAX) {
    if (input.kind === "LINK" || input.kind === "PAGE") {
      url = url ?? rawRefId;
      refId = createHash("sha256").update(rawRefId).digest("hex");
    } else {
      log.warn(`skipped record: refId exceeds ${ARTIFACT_REF_ID_MAX} chars kind=${input.kind}`);
      return null;
    }
  }
  if (url && url.length > ARTIFACT_URL_MAX) url = url.slice(0, ARTIFACT_URL_MAX);
  const title = (input.title?.trim() || refId).slice(0, ARTIFACT_TITLE_MAX);

  const orgId =
    input.orgId ?? (await orgIdForSpacesUser(input.createdByUserId, "conversation-artifacts"));
  if (!orgId) {
    log.warn(`skipped record: no org for user=${input.createdByUserId} kind=${input.kind}`);
    return null;
  }

  const mutable = definedOnly({
    title,
    latestVersionRef: input.latestVersionRef,
    url,
    provider: input.provider,
    messageId: input.messageId,
    runId: input.runId,
    orgId,
  });

  return prisma.conversationArtifact.upsert({
    where: {
      conversationId_kind_refId: { conversationId, kind: input.kind, refId },
    },
    create: {
      conversationId,
      kind: input.kind,
      refService: input.refService,
      refId,
      title,
      createdByUserId: input.createdByUserId,
      messageId: input.messageId ?? null,
      runId: input.runId ?? null,
      url,
      provider: input.provider ?? null,
      latestVersionRef: input.latestVersionRef ?? null,
      orgId,
    },
    update: {
      ...mutable,
      status: "ACTIVE",
    },
  });
}

/** Point an existing artifact row at a new version ref without touching its
 *  title/url — used when the file backing a row is persisted after the row was
 *  first recorded (local workspace diffs land this way). No-op when absent. */
export async function setArtifactVersionRef(args: {
  conversationId: string;
  kind: ConversationArtifactKind;
  refId: string;
  latestVersionRef: string;
  messageId?: string | null;
}): Promise<number> {
  if (!args.conversationId || !args.refId || !args.latestVersionRef) return 0;
  const result = await prisma.conversationArtifact.updateMany({
    where: { conversationId: args.conversationId, kind: args.kind, refId: args.refId },
    data: {
      latestVersionRef: args.latestVersionRef,
      status: "ACTIVE",
      ...(args.messageId ? { messageId: args.messageId } : {}),
    },
  });
  return result.count;
}

export async function listConversationArtifacts(
  conversationId: string,
  userId: string,
): Promise<ConversationArtifact[]> {
  if (!conversationId || !userId) return [];
  const owns = await userOwnsConversation(conversationId, userId);
  return prisma.conversationArtifact.findMany({
    where: {
      conversationId,
      status: { not: "DELETED" },
      ...(owns ? {} : { createdByUserId: userId }),
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
}

export async function userOwnsConversation(conversationId: string, userId: string): Promise<boolean> {
  if (!conversationId || !userId) return false;
  const message = await prisma.chatMessage.findFirst({
    where: { conversationId, userId },
    select: { id: true },
  });
  return message !== null;
}

export async function getConversationArtifact(id: string): Promise<ConversationArtifact | null> {
  if (!id) return null;
  return prisma.conversationArtifact.findUnique({ where: { id } });
}

export interface ConversationArtifactPatch {
  title?: string;
  pinned?: boolean;
  status?: ConversationArtifactStatus;
}

export async function updateConversationArtifact(
  id: string,
  patch: ConversationArtifactPatch,
): Promise<ConversationArtifact> {
  const data: Record<string, unknown> = {};
  if (typeof patch.title === "string" && patch.title.trim()) data["title"] = patch.title.trim().slice(0, 500);
  if (typeof patch.pinned === "boolean") data["pinned"] = patch.pinned;
  if (isArtifactStatus(patch.status)) data["status"] = patch.status;
  return prisma.conversationArtifact.update({ where: { id }, data });
}

export async function findArtifactsByRef(
  refService: ArtifactRefService,
  refId: string,
): Promise<ConversationArtifact[]> {
  if (!isArtifactRefService(refService) || !refId) return [];
  return prisma.conversationArtifact.findMany({
    where: { refService, refId, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
  });
}

export function toOpenRef(artifact: ConversationArtifact): {
  kind: string;
  service: string;
  refId: string;
  url?: string;
  versionRef?: string;
} {
  return {
    kind: artifact.kind,
    service: artifact.refService,
    refId: artifact.refId,
    ...(artifact.url ? { url: artifact.url } : {}),
    ...(artifact.latestVersionRef ? { versionRef: artifact.latestVersionRef } : {}),
  };
}
