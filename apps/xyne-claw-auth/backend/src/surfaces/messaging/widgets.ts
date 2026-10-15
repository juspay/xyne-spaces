/**
 * Spaces cards → what a messenger can show.
 *
 * In Spaces an agent's rich output is Flow JSON: a code card, a diff, a chart,
 * a question form, a connector picker with Connect buttons. None of that
 * renders in a phone chat, and until this module it was simply dropped — the
 * tool told the model "posted", and the person saw nothing.
 *
 * Each card is translated into the messenger's own vocabulary instead:
 *  - code and diffs become a code block, or a document when they are too long
 *    to read inline;
 *  - charts become a few lines of numbers;
 *  - questions become buttons, lists or a native form (questions.ts);
 *  - connector and provider suggestions become tappable sign-in links
 *    (connect.ts), so connecting works from the phone.
 * Plan cards have no messenger counterpart and stay in Spaces.
 *
 * The transforms are pure (`widgetItems`, `connectorCard`) so they can be
 * tested without Redis; the deliver* functions do the I/O.
 */
import type { ChartArtifact, UiWidget } from "xyne-claw-shared";
import {
  resolveSuggestedConnectors,
  type PendingConnectorSuggestions,
  type PendingProviderSuggestions,
} from "../../lib/connector-card-render.js";
import { CONFIG } from "../../config.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { userProviderCredentialsRepository } from "../../repositories/index.js";
import { normalizeProviderName, PROVIDER_LABELS, SUPPORTED_PROVIDERS } from "../../lib/provider-hints.js";
import { newCardToken, parkOptions, type ParkedOption } from "./cards.js";
import { mintConnectLink } from "./connect.js";
import { enqueueOutbound, type OutboxItem } from "./delivery.js";
import { resumeTyping } from "./interim.js";
import { getChannel, type ChannelDeliveryTarget, type InteractiveCard } from "./plugin.js";
import { askChannelQuestions } from "./questions.js";

const log = createLogger("channel-widgets");

/** Past this a code block is a wall on a phone: send it as a file instead. */
const INLINE_CODE_MAX_CHARS = 1_200;
const INLINE_CODE_MAX_LINES = 30;
const CHART_MAX_ROWS = 10;

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: "ts", ts: "ts", tsx: "tsx", javascript: "js", js: "js", jsx: "jsx", python: "py", py: "py",
  go: "go", rust: "rs", java: "java", kotlin: "kt", swift: "swift", ruby: "rb", php: "php", c: "c", cpp: "cpp",
  csharp: "cs", sql: "sql", bash: "sh", shell: "sh", sh: "sh", yaml: "yaml", yml: "yaml", json: "json",
  html: "html", css: "css", markdown: "md", md: "md", haskell: "hs", scala: "scala",
};

function asTextFile(fileName: string, body: string): { fileName: string; mimeType: string; data: string } {
  // text/plain whatever the extension: it is on Meta's document allowlist,
  // and every phone can open it.
  return { fileName, mimeType: "text/plain", data: Buffer.from(body, "utf8").toString("base64") };
}

function fitsInline(body: string): boolean {
  return body.length <= INLINE_CODE_MAX_CHARS && body.split("\n").length <= INLINE_CODE_MAX_LINES;
}

function diffStats(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A chart as the handful of numbers someone would text you about it. */
export function chartAsText(chart: ChartArtifact): string {
  const lines: string[] = [];
  if (chart.caption) lines.push(`**${chart.caption}**`);
  if (chart.type === "line" || chart.type === "area") {
    const bySeries = new Map<string, Array<{ x: string; y: number }>>();
    for (const point of chart.series) {
      const key = point.series ?? "";
      bySeries.set(key, [...(bySeries.get(key) ?? []), { x: point.x, y: point.y }]);
    }
    for (const [name, points] of [...bySeries.entries()].slice(0, CHART_MAX_ROWS)) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const max = points.reduce((best, p) => (p.y > best.y ? p : best), first);
      const min = points.reduce((best, p) => (p.y < best.y ? p : best), first);
      const label = name ? `${name}: ` : "";
      lines.push(
        `- ${label}${formatNumber(first.y)} (${first.x}) → ${formatNumber(last.y)} (${last.x}), high ${formatNumber(max.y)} on ${max.x}, low ${formatNumber(min.y)} on ${min.x}`,
      );
    }
    return lines.join("\n");
  }
  const total = chart.points.reduce((sum, p) => sum + p.value, 0);
  const share = chart.type !== "bar" && total > 0;
  const sorted = [...chart.points].sort((a, b) => b.value - a.value);
  for (const point of sorted.slice(0, CHART_MAX_ROWS)) {
    const pct = share ? ` (${Math.round((point.value / total) * 100)}%)` : "";
    lines.push(`- ${point.label}: ${formatNumber(point.value)}${pct}`);
  }
  if (sorted.length > CHART_MAX_ROWS) lines.push(`- …and ${sorted.length - CHART_MAX_ROWS} more`);
  return lines.join("\n");
}

/**
 * The outbox items a display widget becomes. Empty for widgets with no
 * messenger counterpart (the plan) and for questions, which are asked through
 * questions.ts rather than sent.
 */
export function widgetItems(widget: UiWidget, chatId: string): OutboxItem[] {
  switch (widget.type) {
    case "code": {
      const { code, language } = widget.payload;
      if (fitsInline(code)) return [{ kind: "text", chatId, text: `\`\`\`${language ?? ""}\n${code}\n\`\`\`` }];
      const ext = LANGUAGE_EXTENSIONS[(language ?? "").toLowerCase()] ?? "txt";
      const lines = code.split("\n").length;
      return [{ kind: "file", chatId, attachment: asTextFile(`snippet.${ext}`, code), caption: `${language ?? "Code"} · ${lines} lines` }];
    }
    case "diff": {
      const { path, patch } = widget.payload;
      const { added, removed } = diffStats(patch);
      const summary = `**${path}** · +${added} −${removed}`;
      if (fitsInline(patch)) return [{ kind: "text", chatId, text: `${summary}\n\`\`\`diff\n${patch}\n\`\`\`` }];
      const name = (path.split("/").pop() || "changes").replace(/[^A-Za-z0-9._-]/g, "_");
      return [{ kind: "file", chatId, attachment: asTextFile(`${name}.diff.txt`, patch), caption: summary }];
    }
    case "chart":
      return [{ kind: "text", chatId, text: chartAsText(widget.payload) }];
    case "plan":
    case "question":
      return [];
  }
}

/**
 * Deliver one widget into the chat a run came from. Returns whether anything
 * was sent, which is what the caller's dedup claim records.
 */
export async function deliverChannelWidget(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  widget: UiWidget;
  agentSlug?: string | undefined;
  conversationId?: string | undefined;
}): Promise<boolean> {
  const { target, widget } = input;
  if (widget.type === "question") {
    if (!input.userId) return false;
    await askChannelQuestions({
      target,
      userId: input.userId,
      questionId: widget.payload.questionId,
      questions: widget.payload.questions,
      ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });
    return true;
  }
  const items = widgetItems(widget, target.chatId);
  if (items.length === 0) return false;
  for (const item of items) await enqueueOutbound(target.connectedSurfaceId, item);
  // Mid-run: the run is still working, and sending cleared "typing…".
  await resumeTyping(target);
  log.info(`[widgets] delivered ${widget.type} widget ${widget.id} account=${target.connectedSurfaceId}`);
  return true;
}

interface ConnectorOffer {
  serverType: string;
  name: string;
  description?: string;
  connected: boolean;
}

/** One connector: a single "Connect" button that opens its sign-in. */
export function connectorCtaCard(offer: { name: string; description?: string }, url: string, intro?: string): InteractiveCard {
  // The agent's own reason, when it gave one, says it better than the
  // catalogue's description of the connector.
  const body = intro?.trim()
    ? intro.trim()
    : [`Connect **${offer.name}** so I can use it for you.`, offer.description?.trim()].filter(Boolean).join("\n\n");
  return { kind: "cta", header: offer.name, body, label: "Connect", url, footer: "Opens a secure sign-in" };
}

/**
 * Several connectors: a list to pick from, each row answered with that
 * connector's own link — a WhatsApp card can carry only one URL button.
 * Rows that are already connected stay visible (the roster), marked so.
 */
export function connectorListCard(
  offers: ConnectorOffer[],
  tokens: string[],
  title?: string,
): InteractiveCard {
  return {
    kind: "list",
    header: title?.trim() || "Connect an app",
    body: "Pick one and I'll send you a sign-in link.",
    button: "Choose",
    sections: [
      {
        rows: offers.map((offer, i) => ({
          id: tokens[i]!,
          title: offer.name,
          ...(offer.connected
            ? { description: "Connected" }
            : offer.description
              ? { description: offer.description }
              : {}),
        })),
      },
    ],
  };
}

async function linkFor(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  agentSlug?: string | undefined;
  offer: { serverType: string; name: string };
}): Promise<string> {
  return mintConnectLink({
    userId: input.userId,
    serverType: input.offer.serverType,
    serverName: input.offer.name,
    target: input.target,
    ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
  });
}

/**
 * The connector card the agent's `suggest-connectors` call queued, as
 * sign-in links. Named suggestions drop what the user already has (unless it
 * just failed with 401/403); a roster keeps everything and marks it.
 */
export async function deliverChannelConnectorCards(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  agentSlug?: string | undefined;
  agentOrgId?: string | null | undefined;
  suggestions: PendingConnectorSuggestions;
  blockedConnectors?: string[] | undefined;
}): Promise<boolean> {
  const { target } = input;
  const resolved = await resolveSuggestedConnectors({
    suggestions: input.suggestions,
    blockedConnectors: input.blockedConnectors,
    id: { agentSlug: input.agentSlug, agentOrgId: input.agentOrgId ?? null, userId: input.userId },
  });
  if (!resolved) return false;
  const offers: ConnectorOffer[] = resolved.connectors;
  const plugin = getChannel(target.channel);
  const interactive = plugin?.capabilities.interactive;
  const actionable = offers.filter((offer) => !offer.connected);
  const title = input.suggestions.title ?? (resolved.listAll ? "Connectors you can add" : undefined);

  // One thing to connect: the button itself, no menu in front of it.
  if (actionable.length === 1 && !resolved.listAll && interactive?.cta) {
    const offer = actionable[0]!;
    const url = await linkFor({ target, userId: input.userId, agentSlug: input.agentSlug, offer });
    await enqueueOutbound(target.connectedSurfaceId, { kind: "card", chatId: target.chatId, card: connectorCtaCard(offer, url, title) });
    log.info(`[widgets] connector link sent type=${offer.serverType} account=${target.connectedSurfaceId}`);
    return true;
  }

  if (interactive) {
    const rows = offers.slice(0, interactive.listRows);
    const parked = rows.map((offer) => ({
      token: newCardToken(),
      option: {
        action: { kind: "connect" as const, serverType: offer.serverType },
        chatId: target.chatId,
        senderId: target.senderId,
        userId: input.userId,
        ...(input.agentSlug ? { agentSlug: input.agentSlug } : {}),
      } satisfies ParkedOption,
    }));
    await parkOptions(target.connectedSurfaceId, parked);
    await enqueueOutbound(target.connectedSurfaceId, {
      kind: "card",
      chatId: target.chatId,
      card: connectorListCard(rows, parked.map((p) => p.token), title),
    });
    log.info(`[widgets] connector list sent (${rows.length}) account=${target.connectedSurfaceId}`);
    return true;
  }

  // No native cards: every link inline, so connecting is still one tap.
  const lines = [title?.trim() ? `**${title.trim()}**` : "You can connect these:"];
  for (const offer of offers) {
    if (offer.connected) {
      lines.push(`- **${offer.name}** (connected)`);
      continue;
    }
    const url = await linkFor({ target, userId: input.userId, agentSlug: input.agentSlug, offer });
    lines.push(`- **${offer.name}**: ${url}`);
  }
  await enqueueOutbound(target.connectedSurfaceId, { kind: "text", chatId: target.chatId, text: lines.join("\n") });
  return true;
}

/** A tap on one row of the connector list: answer with that one's link. */
export async function sendConnectorLink(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  serverType: string;
  agentSlug?: string | undefined;
}): Promise<void> {
  const row = await prisma.mcpServer.findUnique({ where: { type: input.serverType }, select: { name: true, description: true } });
  const offer = { serverType: input.serverType, name: row?.name ?? input.serverType, ...(row?.description ? { description: row.description } : {}) };
  const url = await linkFor({ target: input.target, userId: input.userId, agentSlug: input.agentSlug, offer });
  await enqueueOutbound(input.target.connectedSurfaceId, {
    kind: "card",
    chatId: input.target.chatId,
    card: connectorCtaCard(offer, url),
  });
}

/**
 * AI provider suggestions. A provider key or device login is entered in
 * Claw's settings, never in a chat, so the card is a link there.
 */
export async function deliverChannelProviderCards(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  suggestions: PendingProviderSuggestions;
}): Promise<boolean> {
  const { target, suggestions } = input;
  const listAll = suggestions.listAll === true && suggestions.providers.length === 0;
  const named = listAll
    ? [...SUPPORTED_PROVIDERS]
    : [...new Set(suggestions.providers.map((p) => normalizeProviderName(p)).filter((p): p is NonNullable<typeof p> => p !== null))];
  const creds = await userProviderCredentialsRepository.listByUser(input.userId).catch(() => []);
  const connected = new Set(["spaces", ...creds.map((c) => c.provider)]);
  const shown = named.filter((provider) => listAll || !connected.has(provider));
  if (shown.length === 0) return false;
  const names = shown.map((provider) => PROVIDER_LABELS[provider] ?? provider);
  const body =
    suggestions.title?.trim() ||
    (names.length === 1 ? `Add **${names[0]}** in your Claw settings and I can use it.` : `You can add these in your Claw settings: ${names.join(", ")}.`);
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "card",
    chatId: target.chatId,
    card: { kind: "cta", body, label: "Open settings", url: `${CONFIG.frontendUrl}v3/settings` },
  });
  return true;
}

/** What the agent's describe-agent call queued (the result payload's
 *  `pendingAgentCard`). Drafts (propose-agent) need the Spaces approval card
 *  and are not offered here. */
export type AgentCardRequest =
  | { variant: "profile"; slug?: string }
  | { variant: "profile-list"; slugs: string[] }
  | { variant: "summary" }
  | { variant: "draft" };

const AGENT_ROSTER_ROWS = 10;

/**
 * Agent profile and roster cards as something to tap: each agent is an
 * option that starts a conversation with it, the same as typing /slug — so
 * routing, access checks and per-agent history are the existing ones.
 */
export async function deliverChannelAgentCards(input: {
  target: ChannelDeliveryTarget;
  userId: string;
  orgId: string;
  currentAgentSlug?: string | undefined;
  card: AgentCardRequest;
}): Promise<boolean> {
  const { target, card } = input;
  const select = { slug: true, name: true, description: true } as const;
  let agents: Array<{ slug: string; name: string; description: string | null }> = [];
  let header = "";
  let body = "";
  if (card.variant === "profile") {
    const slug = card.slug?.trim() || input.currentAgentSlug;
    const row = slug ? await prisma.agent.findFirst({ where: { slug, orgId: input.orgId, enabled: true }, select }) : null;
    if (row) agents = [row];
  } else if (card.variant === "profile-list") {
    const slugs = [...new Set(card.slugs.map((s) => s.trim()).filter(Boolean))].slice(0, AGENT_ROSTER_ROWS);
    const rows = await prisma.agent.findMany({ where: { slug: { in: slugs }, orgId: input.orgId, enabled: true }, select });
    agents = slugs.map((slug) => rows.find((row) => row.slug === slug)).filter((row): row is (typeof rows)[number] => !!row);
    header = `${agents.length === 1 ? "An agent" : `${agents.length} agents`} that can help`;
    body = "Tap one to talk to it.";
  } else if (card.variant === "summary") {
    const [total, rows] = await Promise.all([
      prisma.agent.count({ where: { orgId: input.orgId, enabled: true } }),
      prisma.agent.findMany({ where: { orgId: input.orgId, enabled: true }, select, orderBy: { name: "asc" }, take: AGENT_ROSTER_ROWS }),
    ]);
    agents = rows;
    header = "Agents you can use";
    body = total > rows.length ? `${total} in your org — here are ${rows.length}. Send /agents for the full list, or tap one.` : "Tap one to talk to it.";
  }
  if (agents.length === 0) return false;

  const parked = agents.map((agent) => ({
    token: newCardToken(),
    option: {
      action: { kind: "agent" as const, slug: agent.slug },
      chatId: target.chatId,
      senderId: target.senderId,
      userId: input.userId,
    } satisfies ParkedOption,
  }));
  await parkOptions(target.connectedSurfaceId, parked);

  const profile = agents.length === 1 && card.variant === "profile" ? agents[0]! : null;
  const out: InteractiveCard = profile
    ? {
        kind: "buttons",
        body: [`**${profile.name}** (/${profile.slug})`, profile.description?.trim()].filter(Boolean).join("\n\n"),
        buttons: [{ id: parked[0]!.token, title: `Chat with ${profile.name}` }],
      }
    : {
        kind: "list",
        header,
        body,
        button: "Choose",
        sections: [
          {
            rows: agents.map((agent, i) => ({
              id: parked[i]!.token,
              title: agent.name,
              description: agent.description?.trim() || `/${agent.slug}`,
            })),
          },
        ],
      };
  await enqueueOutbound(target.connectedSurfaceId, { kind: "card", chatId: target.chatId, card: out });
  log.info(`[widgets] agent ${card.variant} card sent (${agents.length}) account=${target.connectedSurfaceId}`);
  return true;
}
