import type { AgentWidgetBinding } from "@prisma/client";
import { prisma } from "../db.js";
import { readPrBindingData } from "./agent-widget-binding.js";

export const MAX_CONTEXT_PR_BINDINGS = 20;
const MAX_TITLE_CHARS = 160;

export interface ConversationPrBinding {
  provider: string;
  title: string;
  status: string | null;
  agentSlug: string | null;
  repo?: string;
  number?: string | number;
  url?: string;
}

const STATUS_LABELS: Record<string, string> = {
  created: "open",
  merged: "merged",
  reverted: "reverted",
  deleted: "deleted",
  declined: "declined",
};

export function toConversationPrBinding(row: AgentWidgetBinding): ConversationPrBinding | null {
  const data = readPrBindingData(row);
  if (!data) return null;
  return {
    provider: data.provider,
    title: data.title,
    status: row.status,
    agentSlug: row.agentSlug,
    ...(data.repo ? { repo: data.repo } : {}),
    ...(data.number !== undefined ? { number: data.number } : {}),
    ...(data.url ? { url: data.url } : {}),
  };
}

export async function listConversationPrBindings(conversationId: string): Promise<ConversationPrBinding[]> {
  if (!conversationId) return [];
  const rows = await prisma.agentWidgetBinding.findMany({
    where: { kind: "pr", conversationId },
    orderBy: { updatedAt: "desc" },
    take: MAX_CONTEXT_PR_BINDINGS,
  });
  return rows.flatMap((row) => {
    const binding = toConversationPrBinding(row);
    return binding ? [binding] : [];
  });
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function prLabel(binding: ConversationPrBinding): string {
  const number = binding.number !== undefined && binding.number !== "" ? `#${binding.number}` : "";
  if (binding.repo && number) return `${binding.repo}${number}`;
  if (number) return `PR ${number}`;
  return binding.repo ? `PR in ${binding.repo}` : "PR";
}

export function prBindingsContextBlock(bindings: readonly ConversationPrBinding[], selfSlug: string): string {
  if (bindings.length === 0) return "";
  const lines = bindings.map((binding) => {
    const status = binding.status ? (STATUS_LABELS[binding.status] ?? binding.status) : "open";
    const author = !binding.agentSlug
      ? "an agent"
      : binding.agentSlug === selfSlug
        ? "you"
        : `@${binding.agentSlug}`;
    const parts = [
      `**${prLabel(binding)}**`,
      `"${oneLine(binding.title, MAX_TITLE_CHARS)}"`,
      `status: ${status}`,
      `opened by ${author}`,
      `provider: ${binding.provider}`,
    ];
    if (binding.url) parts.push(binding.url);
    return `- ${parts.join(" · ")}`;
  });
  return [
    "## Pull requests in this thread",
    "These PR cards are posted in this thread and tracked by Xyne; their status is kept up to date. They were opened by the agents named below — treat them as known facts. Don't say a PR came from the user or ask where it came from, and refer to them by number when you talk about them.",
    "",
    ...lines,
  ].join("\n");
}
