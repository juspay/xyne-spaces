import { basename, dirname } from 'path';

export interface ParsedWhatsAppMessage {
  externalId: string;
  timestamp: Date;
  senderName: string | null;
  content: string;
  mediaRef: string | null;
  isSystemMessage: boolean;
  isEdited: boolean;
  isMediaOmitted: boolean;
  sequenceNumber: number;
}

export interface ParsedWhatsAppChat {
  chatName: string | null;
  participants: string[];
  messages: ParsedWhatsAppMessage[];
}

type MessageStartMatch =
  | {
      timestamp: Date;
      senderName: string;
      content: string;
      isSystemMessage: false;
    }
  | {
      timestamp: Date;
      senderName: null;
      content: string;
      isSystemMessage: true;
    };

const MESSAGE_PATTERNS = [
  /^(?<date>\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(?<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\s-\s(?<sender>[^:]+?):\s(?<content>.*)$/u,
  /^(?<date>\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(?<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\s-\s(?<content>.*)$/u,
  /^\[(?<date>\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(?<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\]\s(?<sender>[^:]+?):\s(?<content>.*)$/u,
  /^\[(?<date>\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}),\s(?<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)\]\s(?<content>.*)$/u,
];

const MEDIA_REF_REGEX =
  /<attached:\s*([^>]+)>|([A-Za-z0-9 _.'()&+\-[\],]+\.(?:jpg|jpeg|png|gif|webp|mp4|mov|avi|m4v|m4a|aac|ogg|opus|pdf|doc|docx|xls|xlsx|csv|tsv|ppt|pptx|vcf|txt))/iu;
const WHATSAPP_MEDIA_TOKEN_REGEX =
  /\b(?:IMG|VID|AUD|PTT|DOC|STK)-\d{8}-WA\d{4}(?:\.[A-Za-z0-9]+)?\.?\b/iu;
const WHATSAPP_OMITTED_MEDIA_REGEX =
  /<Media omitted>|(?:^|\s)[^\n]+?\s[•·]\s\d+.*\bomitted\b|^(?:video|image|photo|audio|gif|document|sticker|contact card|media)\s+omitted$/iu;
const WHATSAPP_CONTROL_CHARS_REGEX = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ');
const normalizeSystemContent = (value: string): string =>
  value
    .replace(WHATSAPP_CONTROL_CHARS_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const WHATSAPP_SYSTEM_EVENT_PATTERNS = [
  /\bmessages and calls are end-to-end encrypted\b/,
  /\bsecurity code\b/,
  /\bcreated (this )?group\b/,
  /\bchanged the (subject|group name) to\b/,
  /\bchanged this group's icon\b/,
  /\bdeleted this group's icon\b/,
  /\badded you\b/,
  /\badded\b/,
  /\bremoved\b/,
  /\bleft\b/,
  /\bjoined using this group's invite link\b/,
  /\bwere added\b/,
  /\bwas added\b/,
  /\byou were added\b/,
  // deleted messages
  /\bthis message was deleted\b/,
  /\byou deleted this message\b/,
  // missed calls
  /\bmissed (group )?(voice|video) call\b/,
  // admin changes
  /\bmade .+ an admin\b/,
  /\bis now an admin\b/,
  /\byou('re| are) now an admin\b/,
  /\byou('re| are) no longer an admin\b/,
  /\bremoved .+ as admin\b/,
  // disappearing messages
  /\bturned on disappearing messages\b/,
  /\bturned off disappearing messages\b/,
  /\bdisappearing messages (was )?turned (on|off)\b/,
  /\bkeep disappearing messages (on|off)\b/,
  // phone number change
  /\bchanged (their|your) phone number\b/,
  /\bchanged to a new phone number\b/,
  // live location
  /\blive location shared\b/,
  /\blive location stopped\b/,
  /\bstarted sharing (their )?live location\b/,
  /\bstopped sharing (their )?live location\b/,
  // view-once / tap to view (expired)
  /\btap to view\b/,
  /\bopened\b.*\bview once\b/,
  // community / announce
  /\bonly admins can send messages\b/,
  /\ball members can send messages\b/,
  /\blink (was )?reset\b/,
  /\bgroup link (was )?reset\b/,
];

function detectDateFormat(lines: string[]): boolean {
  for (const line of lines) {
    const normalized = line.replace(WHATSAPP_CONTROL_CHARS_REGEX, '');
    for (const pattern of MESSAGE_PATTERNS) {
      const match = pattern.exec(normalized);
      if (!match?.groups?.date) continue;
      const [p1Raw, p2Raw] = match.groups.date.split(/[\/.-]/);
      const p1 = Number(p1Raw);
      const p2 = Number(p2Raw);
      if (p1 > 12) return true;  // p1 can't be month → day-first
      if (p2 > 12) return false; // p2 can't be month → month-first
    }
  }
  return true; // default DD/MM — most common WhatsApp locale globally
}

function parseDatePart(rawDate: string, dayFirst: boolean): { year: number; month: number; day: number } {
  const [part1Raw, part2Raw, part3Raw] = rawDate.split(/[\/.-]/);
  const part1 = Number(part1Raw);
  const part2 = Number(part2Raw);
  const part3 = Number(part3Raw);
  const year = part3 < 100 ? 2000 + part3 : part3;
  return dayFirst
    ? { year, month: part2, day: part1 }
    : { year, month: part1, day: part2 };
}

function parseTimePart(rawTime: string): { hours: number; minutes: number; seconds: number } {
  const trimmed = rawTime.trim().replace(/\./g, '');
  const meridiemMatch = trimmed.match(/\s([AaPp][Mm])$/);
  const timePortion = meridiemMatch ? trimmed.slice(0, -meridiemMatch[0].length) : trimmed;
  const [hoursRaw, minutesRaw, secondsRaw] = timePortion.split(':');

  let hours = Number(hoursRaw);
  const minutes = Number(minutesRaw || '0');
  const seconds = Number(secondsRaw || '0');

  if (meridiemMatch) {
    const meridiem = meridiemMatch[1].toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }

  return { hours, minutes, seconds };
}

function parseTimestamp(rawDate: string, rawTime: string, dayFirst: boolean): Date | null {
  try {
    const { year, month, day } = parseDatePart(rawDate, dayFirst);
    const { hours, minutes, seconds } = parseTimePart(rawTime);
    const timestamp = new Date(year, month - 1, day, hours, minutes, seconds, 0);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  } catch {
    return null;
  }
}

function matchMessageStart(line: string, dayFirst: boolean): MessageStartMatch | null {
  const normalizedLine = line.replace(WHATSAPP_CONTROL_CHARS_REGEX, '');

  for (const pattern of MESSAGE_PATTERNS) {
    const match = pattern.exec(normalizedLine);
    if (!match || !match.groups) continue;

    const timestamp = parseTimestamp(match.groups.date, match.groups.time, dayFirst);
    if (!timestamp) continue;

    if (typeof match.groups.sender === 'string') {
      return {
        timestamp,
        senderName: normalizeName(match.groups.sender),
        content: match.groups.content || '',
        isSystemMessage: false,
      };
    }

    return {
      timestamp,
      senderName: null,
      content: match.groups.content || '',
      isSystemMessage: true,
    };
  }

  return null;
}

function extractMediaRef(content: string): string | null {
  const match = MEDIA_REF_REGEX.exec(content);
  if (match) {
    return (match[1] || match[2] || '').trim() || null;
  }

  const tokenMatch = WHATSAPP_MEDIA_TOKEN_REGEX.exec(content);
  if (!tokenMatch) return null;
  return tokenMatch[0].trim() || null;
}

function detectEdited(content: string): boolean {
  return /<This message was edited>/iu.test(content);
}

function stripEditedMarker(content: string): string {
  return content.replace(/\s*<This message was edited>/giu, '').trim();
}

function detectMediaOmitted(content: string): boolean {
  return WHATSAPP_OMITTED_MEDIA_REGEX.test(content);
}

function detectSystemEvent(content: string): boolean {
  const normalized = normalizeSystemContent(content);
  return WHATSAPP_SYSTEM_EVENT_PATTERNS.some(pattern => pattern.test(normalized));
}

function isGroupSenderSystemEvent(senderName: string | null, chatName: string | null): boolean {
  if (!senderName || !chatName) return false;
  return normalizeName(senderName).toLowerCase() === normalizeName(chatName).toLowerCase();
}

function sanitizeChatName(value: string): string | null {
  return value.replace(/^WhatsApp Chat (with |[-–] ?)/i, '').trim() || null;
}

function deriveChatName(chatFilePath: string, archiveName?: string | null): string | null {
  const name = basename(chatFilePath, '.txt');
  if (name !== '_chat') {
    return sanitizeChatName(name);
  }

  const parentDirName = basename(dirname(chatFilePath));
  const normalizedParentDirName = sanitizeChatName(parentDirName);
  if (
    normalizedParentDirName &&
    !/^xyne-whatsapp-extract-/i.test(normalizedParentDirName)
  ) {
    return normalizedParentDirName;
  }

  if (archiveName) {
    return sanitizeChatName(archiveName);
  }

  return normalizedParentDirName;
}

export function parseWhatsAppChat(
  chatText: string,
  chatFilePath: string,
  archiveName?: string | null,
): ParsedWhatsAppChat {
  const lines = chatText.replace(/\r\n/g, '\n').split('\n');
  const dayFirst = detectDateFormat(lines);
  const chatName = deriveChatName(chatFilePath, archiveName);
  const participants = new Set<string>();
  const messages: ParsedWhatsAppMessage[] = [];

  let current: MessageStartMatch | null = null;
  let currentContent = '';
  let sequenceNumber = 0;

  const flushCurrent = (): void => {
    if (!current) return;

    const content = currentContent.trim();
    if (!content) {
      current = null;
      currentContent = '';
      return;
    }

    sequenceNumber += 1;
    const isEdited = detectEdited(content);
    const normalizedContent = isEdited ? stripEditedMarker(content) : content;
    const isMediaOmitted = detectMediaOmitted(normalizedContent);
    const isSystemMessage =
      current.isSystemMessage ||
      detectSystemEvent(normalizedContent) ||
      (isGroupSenderSystemEvent(current.senderName, chatName) && detectSystemEvent(normalizedContent));

    if (current.senderName && !isSystemMessage) participants.add(current.senderName);

    messages.push({
      externalId: `${current.timestamp.toISOString()}::${isSystemMessage ? 'system' : current.senderName || 'system'}::${sequenceNumber}`,
      timestamp: current.timestamp,
      senderName: isSystemMessage ? null : current.senderName,
      content: normalizedContent,
      mediaRef: isMediaOmitted ? null : extractMediaRef(normalizedContent),
      isSystemMessage,
      isEdited,
      isMediaOmitted,
      sequenceNumber,
    });

    current = null;
    currentContent = '';
  };

  for (const line of lines) {
    const start = matchMessageStart(line, dayFirst);
    if (start) {
      flushCurrent();
      current = start;
      currentContent = start.content || '';
      continue;
    }

    if (current) {
      currentContent = currentContent ? `${currentContent}\n${line}` : line;
    }
  }

  flushCurrent();

  messages.sort((left, right) => {
    const delta = left.timestamp.getTime() - right.timestamp.getTime();
    return delta !== 0 ? delta : left.sequenceNumber - right.sequenceNumber;
  });

  return {
    chatName,
    participants: [...participants],
    messages,
  };
}
