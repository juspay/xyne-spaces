import {
  COMMAND_SECTION_LABELS,
  COMMAND_SECTION_ORDER,
  commandsForSurface,
} from '@xyne/shared/commands';

import type { AttachedFile } from '../api/xyneAIRequest';

const LEADING_COMMAND = /^\s*\/[^\s@#/]*\s?/;

const commands = commandsForSurface('ai-screen');

export const commandSections = COMMAND_SECTION_ORDER.map(section => ({
  title: COMMAND_SECTION_LABELS[section],
  commands: commands.filter(command => command.section === section),
})).filter(({ commands: inSection }) => inSection.length > 0);

/** The agent reads a command from the start of the message, so a pick replaces one already there. */
export const withCommand = (text: string, name: string): string =>
  `/${name} ${text.replace(LEADING_COMMAND, '')}`;

// The server's limits, kept in sync with the web composer.
const MB = 1024 * 1024;
export const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * MB;
const MAX_TOTAL_BYTES = 25 * MB;
const base64Bytes = ({ data = '' }: AttachedFile): number => Math.floor((data.length * 3) / 4);

/** Why `incoming` cannot join `existing`, or null when it can. */
export function fileLimitError(
  existing: AttachedFile[],
  incoming: { originalFilename: string; size: number }[],
): string | null {
  const oversized = incoming.filter(({ size }) => size > MAX_FILE_BYTES);
  if (oversized.length > 0) {
    const names = oversized.map(({ originalFilename }) => originalFilename).join(', ');
    return `File(s) too large: ${names}. Maximum file size is 10MB.`;
  }
  const total =
    existing.reduce((sum, file) => sum + base64Bytes(file), 0) +
    incoming.reduce((sum, { size }) => sum + size, 0);
  return total > MAX_TOTAL_BYTES
    ? `Total attachment size (${Math.round(total / MB)}MB) exceeds the 25MB limit. Please remove some attachments.`
    : null;
}
