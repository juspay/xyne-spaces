import type { ExtractorOutput } from '../enc-contracts/extractors.js';

/** `/<bot-name> <params…>` once HTML tags are stripped. */
export const BOT_COMMAND_REGEX = /\/([a-zA-Z-]+)\s+(.*)/;
/** `--key value`, `--key "quoted value"` or `--key 'quoted value'`. */
export const BOT_PARAM_REGEX = /--(\w+)\s+(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;

/** Message content with HTML tags removed and trimmed, as bot commands are parsed. */
export function stripBotCommandContent(content: string): string {
  return content.replace(/<[^>]*>/g, '').trim();
}

export function isBotCommandContent(content: string): boolean {
  return stripBotCommandContent(content).startsWith('/');
}

export interface ParsedBotCommandText {
  botName: string;
  parameters: Record<string, string>;
  rawCommand: string;
  paramString: string;
}

/** Bot name and `--key value` parameters of a `/command`, or null when it is not one. */
export function parseBotCommandText(content: string): ParsedBotCommandText | null {
  const strippedContent = stripBotCommandContent(content);
  if (!strippedContent.startsWith('/')) return null;

  const match = strippedContent.match(BOT_COMMAND_REGEX);
  if (!match) return null;

  const botName = match[1];
  const paramString = match[2];
  const parameters: Record<string, string> = {};
  for (const paramMatch of paramString.matchAll(BOT_PARAM_REGEX)) {
    parameters[paramMatch[1]] = paramMatch[2] || paramMatch[3] || paramMatch[4];
  }

  return { botName, parameters, rawCommand: strippedContent, paramString };
}

export function extractCommand(text: string): ExtractorOutput['command'] {
  const parsed = parseBotCommandText(text);
  return {
    isBot: isBotCommandContent(text),
    name: parsed?.botName ?? null,
    args: parsed?.paramString ?? null,
  };
}
