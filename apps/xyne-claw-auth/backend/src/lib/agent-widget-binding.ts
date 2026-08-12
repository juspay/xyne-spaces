import { Prisma, type AgentWidgetBinding } from "@prisma/client";
import { isUiWidget, type UiWidget, type UiWidgetType } from "xyne-claw-shared";
import { prisma } from "../db.js";

export type WidgetKind = UiWidgetType;

export function normalizePrUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export interface WidgetBindingInput {
  orgId: string;
  kind: WidgetKind;
  screenId: string;
  externalKey?: string | null;
  conversationId: string;
  channelId: string;
  messageId?: string | null;
  spacesAppId: string;
  spacesAppUserId: string;
  agentSlug?: string | null;
  status?: string | null;
  data?: Record<string, unknown>;
}

export async function upsertWidgetBinding(input: WidgetBindingInput): Promise<void> {
  const data: Prisma.InputJsonValue | typeof Prisma.JsonNull = input.data
    ? input.data as Prisma.InputJsonValue
    : Prisma.JsonNull;
  const common = {
    orgId: input.orgId,
    externalKey: input.externalKey ?? null,
    conversationId: input.conversationId,
    channelId: input.channelId,
    messageId: input.messageId ?? null,
    spacesAppId: input.spacesAppId,
    spacesAppUserId: input.spacesAppUserId,
    agentSlug: input.agentSlug ?? null,
    status: input.status ?? null,
    data,
  };
  await prisma.agentWidgetBinding.upsert({
    where: {
      kind_screenId_conversationId_spacesAppId: {
        kind: input.kind,
        screenId: input.screenId,
        conversationId: input.conversationId,
        spacesAppId: input.spacesAppId,
      },
    },
    create: { kind: input.kind, screenId: input.screenId, ...common },
    update: common,
  });
}

/** Versioned JSON stored for every tool-authored widget binding. */
export function buildWidgetBindingData(widget: UiWidget): Record<string, unknown> {
  return { schemaVersion: 1, widget };
}

export function readBoundUiWidget(row: Pick<AgentWidgetBinding, "data">): UiWidget | null {
  const data = row.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  return isUiWidget(data["widget"]) ? data["widget"] : null;
}

export async function findPrBindingByUrl(prUrl: string): Promise<AgentWidgetBinding | null> {
  const externalKey = normalizePrUrl(prUrl);
  if (!externalKey) return null;
  return prisma.agentWidgetBinding.findFirst({
    where: { kind: "pr", externalKey },
    orderBy: { updatedAt: "desc" },
  });
}

export async function setWidgetBindingStatus(id: string, status: string, messageId?: string): Promise<void> {
  await prisma.agentWidgetBinding.update({
    where: { id },
    data: { status, ...(messageId ? { messageId } : {}) },
  });
}

export interface PrBindingData {
  provider: string;
  title: string;
  url?: string;
  ticketId?: string;
  desc?: string;
  detailsUrl?: string;
  repo?: string;
  number?: string | number;
}

export function readPrBindingData(row: AgentWidgetBinding): PrBindingData | null {
  const boundWidget = readBoundUiWidget(row);
  const raw = boundWidget?.type === "pr"
    ? boundWidget.payload as unknown as Record<string, unknown>
    : row.data as Record<string, unknown> | null; // pre-unification compatibility
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw["provider"] !== "string" || typeof raw["title"] !== "string") return null;
  const result: PrBindingData = { provider: raw["provider"], title: raw["title"] };
  for (const field of ["url", "ticketId", "desc", "detailsUrl", "repo"] as const) {
    if (typeof raw[field] === "string") result[field] = raw[field];
  }
  if (typeof raw["number"] === "string" || typeof raw["number"] === "number") result.number = raw["number"];
  return result;
}
