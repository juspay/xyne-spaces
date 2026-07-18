/**
 * Registry of leading slash-commands for the Cmd+K search box. `/call` and `/chat` bypass Vespa
 * entirely: the box switches to a client-side user/channel picker instead of searching. `/askai`
 * opens the Xyne AI panel; `/record` starts an audio recording; `/goto` jumps to any nav-bar
 * section. Recognised only at the very start of the input.
 *
 * The command's identity is the object KEY — it doubles as the word typed after the slash, the
 * regex alternative, and the `data-command-word` DOM attribute. Everything else is metadata on the
 * value; behaviour lives in the consumer (`useSlashCommands`), which owns the hooks each command
 * needs. To add a command, add one entry here (+ one dispatch arm if its behaviour is new).
 */
import { Phone, MessageSquare, Sparkles, Mic, Compass, type LucideIcon } from 'lucide-react';

// Value = metadata + structural family. No `kind`/`word`/`action` field — the KEY is the identity.
type CommandDef =
  | { type: 'picker'; label: string; icon: LucideIcon; pickerAction: 'call' | 'compose' }
  | {
      type: 'action';
      label: string;
      icon: LucideIcon;
      heading: string;
      title: string;
      description: string;
    }
  // `goto` family: opens a picker of the app's nav-bar sections and routes to the chosen one.
  | { type: 'goto'; label: string; icon: LucideIcon; heading: string };

export const COMMAND_CATALOG = {
  chat: {
    type: 'picker',
    label: 'Message a person or channel',
    icon: MessageSquare,
    pickerAction: 'compose',
  },
  call: { type: 'picker', label: 'Call a person or channel', icon: Phone, pickerAction: 'call' },
  goto: {
    type: 'goto',
    label: 'Go to a section',
    icon: Compass,
    heading: 'Navigate',
  },
  askai: {
    type: 'action',
    label: 'Ask Xyne AI',
    icon: Sparkles,
    heading: 'Ask AI',
    title: 'Ask Xyne AI',
    description: 'Open the Xyne AI panel',
  },
  record: {
    type: 'action',
    label: 'Start a recording',
    icon: Mic,
    heading: 'Recordings',
    title: 'Start recording',
    description: 'Start a new audio recording',
  },
} satisfies Record<string, CommandDef>;

// Identity type + ordered key list — both derived, so the kinds are listed exactly once (the keys).
export type SearchCommandKind = keyof typeof COMMAND_CATALOG;
export const COMMAND_KINDS = Object.keys(COMMAND_CATALOG) as SearchCommandKind[];

export const getCommand = (kind: SearchCommandKind): CommandDef => COMMAND_CATALOG[kind];

// Regex derived from the catalog keys — no second hand-kept list to drift. Each key is escaped
// (defensive if a future key has a regex-special char) and sorted longest-first (prefix-safe).
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = [...COMMAND_KINDS]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');
// Leading `/<command>` (case-insensitive). Group 1 = command token, group 2 = the argument after
// the first run of spaces (empty until one is typed).
const SEARCH_COMMAND_REGEX = new RegExp(`^\\/(${alternation})(?:[ \\t]+([\\s\\S]*))?$`, 'i');

/**
 * Detect a leading slash-command. Returns null unless the text starts with a complete command
 * token. `arg` is everything after the token, trimmed so trailing whitespace/newlines don't leak
 * into the picker query or the `@`/`#` scope.
 */
export function parseSearchCommand(text: string): { kind: SearchCommandKind; arg: string } | null {
  const match = text.match(SEARCH_COMMAND_REGEX);
  if (!match || !match[1]) return null;
  const token = match[1].toLowerCase();
  // The token IS the kind (keys are lowercase); validate it's a known key before the cast.
  if (!(token in COMMAND_CATALOG)) return null;
  return { kind: token as SearchCommandKind, arg: (match[2] ?? '').trim() };
}
