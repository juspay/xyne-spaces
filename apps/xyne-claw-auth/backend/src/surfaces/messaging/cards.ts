/**
 * Cards: the channel-neutral middle ground between "the messenger renders a
 * tappable card" and "the person only ever sees words".
 *
 * Claw's tools were written for the Spaces web app, where an approval or a
 * picker arrives as a card the model is told NOT to describe. On a messenger
 * either that card renders natively (WhatsApp Cloud) or it does not exist at
 * all (Baileys, and anything we add that lacks interactive messages). Both
 * cases are served from here: `fitCard` trims a card to a messenger's hard
 * caps, `renderCardAsText` turns the same card into a numbered menu, and the
 * option ids are parked in Redis so a tap OR a typed "1" resolves back to the
 * same action.
 *
 * Why ids are opaque tokens rather than encoded payloads: WhatsApp caps a
 * button id at 256 characters, which a signed write action does not fit in,
 * and an id that travels through the person's phone is attacker-controlled on
 * the way back. A random token that indexes server-side state has neither
 * problem.
 */
import { randomBytes } from "node:crypto";
import { redisService } from "../../redis.js";
import { createLogger } from "../../logger.js";
import { REDIS_PREFIX } from "./const.js";
import type { SignedWriteAction } from "../../lib/approved-write.js";
import type { InteractiveCard, InteractiveLimits } from "./plugin.js";

const log = createLogger("channel-cards");

/** Parked options live as long as WhatsApp's customer-service window: past it
 *  we could not send the outcome back anyway. */
const CARD_TTL_S = 24 * 60 * 60;
/** A typed "1" only resolves against the most recent menu, and not for long —
 *  it is far weaker evidence of intent than a tap on a specific button. */
const CARD_MENU_TTL_S = 30 * 60;

/** What tapping an option actually does. Deliberately small and explicit: a
 *  card can never carry a free-form instruction back into the runtime. */
export type CardAction =
  | { kind: "approve-write"; label: string }
  | { kind: "decline-write"; label: string }
  | { kind: "agent"; slug: string }
  | { kind: "reply"; text: string };

export interface ParkedOption {
  action: CardAction;
  /** The chat the option was offered in. A token is only valid coming back
   *  from the same chat AND the same person it was shown to. */
  chatId: string;
  senderId: string;
  /** The claw user the originating run belonged to. For a write approval this
   *  must equal the user the action's signature was minted for. */
  userId: string;
  /** Present for approve/decline options. */
  write?: SignedWriteAction;
  /** Conversation the run used, so a follow-up lands in the same history. */
  conversationId?: string;
  agentSlug?: string;
}

function redis() {
  return redisService.getConnection();
}

function optionKey(accountId: string, token: string): string {
  return `${REDIS_PREFIX}:card:${accountId}:${token}`;
}

function menuKey(accountId: string, chatId: string): string {
  return `${REDIS_PREFIX}:cardmenu:${accountId}:${chatId}`;
}

export function newCardToken(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Park the options of one card. Returns nothing: the tokens are already the
 * ids inside `card`, put there by whoever built it.
 */
export async function parkOptions(
  accountId: string,
  options: Array<{ token: string; option: ParkedOption }>,
): Promise<void> {
  if (options.length === 0) return;
  const pipe = redis().multi();
  for (const { token, option } of options) {
    pipe.set(optionKey(accountId, token), JSON.stringify(option), "EX", CARD_TTL_S);
  }
  // The numbered fallback: "1" means the first token of the newest menu.
  const chatId = options[0]!.option.chatId;
  pipe.set(menuKey(accountId, chatId), JSON.stringify(options.map((o) => o.token)), "EX", CARD_MENU_TTL_S);
  await pipe.exec();
}

/**
 * Resolve a tapped id, single-use. A token survives exactly one redemption so
 * a forwarded message or a double-tap cannot run a write twice.
 */
export async function consumeOption(accountId: string, token: string): Promise<ParkedOption | null> {
  const key = optionKey(accountId, token);
  try {
    const raw = await redis().getdel(key);
    return raw ? (JSON.parse(raw) as ParkedOption) : null;
  } catch (err) {
    log.warn(`[cards] option lookup failed account=${accountId}: ${String(err)}`);
    return null;
  }
}

/** Resolve a typed "2" against the newest menu in this chat. */
export async function tokenForMenuChoice(accountId: string, chatId: string, choice: number): Promise<string | null> {
  try {
    const raw = await redis().get(menuKey(accountId, chatId));
    if (!raw) return null;
    const tokens = JSON.parse(raw) as string[];
    return tokens[choice - 1] ?? null;
  } catch {
    return null;
  }
}

/** A bare "2" / "2." / "#2" and nothing else. Anything wordier is a message. */
export function parseMenuChoice(text: string): number | null {
  const match = /^#?\s*([1-9]\d?)\s*[.)]?$/.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 10 ? n : null;
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Trim a card to what the messenger will actually accept. Meta rejects the
 * whole send for a single over-long row, so this runs before every native
 * card rather than trusting callers to know the caps.
 */
export function fitCard(card: InteractiveCard, limits: InteractiveLimits): InteractiveCard {
  const base = {
    body: clip(card.body, limits.bodyChars),
    ...(card.header ? { header: clip(card.header, limits.headerChars) } : {}),
    ...(card.footer ? { footer: clip(card.footer, limits.footerChars) } : {}),
  };
  switch (card.kind) {
    case "buttons":
      return {
        kind: "buttons",
        ...base,
        buttons: card.buttons.slice(0, limits.buttons).map((b) => ({ id: b.id, title: clip(b.title, limits.buttonTitleChars) })),
      };
    case "list": {
      let budget = limits.listRows;
      const out: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }> = [];
      for (const section of card.sections) {
        if (budget <= 0) break;
        const rows = section.rows.slice(0, budget).map((r) => ({
          id: r.id,
          title: clip(r.title, limits.rowTitleChars),
          ...(r.description ? { description: clip(r.description, limits.rowDescriptionChars) } : {}),
        }));
        if (rows.length === 0) continue;
        budget -= rows.length;
        out.push({ ...(section.title ? { title: clip(section.title, limits.rowTitleChars) } : {}), rows });
      }
      return { kind: "list", ...base, button: clip(card.button, limits.buttonTitleChars), sections: out };
    }
    case "cta":
      return { kind: "cta", ...base, label: clip(card.label, limits.buttonTitleChars), url: card.url };
  }
}

/**
 * The same card as words, for messengers with no interactive support. The
 * numbering is what `parseMenuChoice` reads back, so the two must agree.
 */
export function renderCardAsText(card: InteractiveCard): string {
  const lines: string[] = [];
  if (card.header) lines.push(`*${card.header}*`);
  lines.push(card.body);
  switch (card.kind) {
    case "buttons": {
      lines.push("");
      card.buttons.forEach((b, i) => lines.push(`${i + 1}. ${b.title}`));
      lines.push("");
      lines.push("Reply with the number.");
      break;
    }
    case "list": {
      let n = 0;
      for (const section of card.sections) {
        lines.push("");
        if (section.title) lines.push(`*${section.title}*`);
        for (const row of section.rows) {
          n += 1;
          lines.push(row.description ? `${n}. ${row.title} — ${row.description}` : `${n}. ${row.title}`);
        }
      }
      lines.push("");
      lines.push("Reply with the number.");
      break;
    }
    case "cta": {
      lines.push("");
      lines.push(`${card.label}: ${card.url}`);
      break;
    }
  }
  if (card.footer) {
    lines.push("");
    lines.push(card.footer);
  }
  return lines.join("\n");
}
