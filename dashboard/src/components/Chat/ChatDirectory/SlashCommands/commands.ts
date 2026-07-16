/**
 * Leading slash-commands for the Cmd+K search box. `/call` and `/chat` bypass Vespa
 * entirely: the box switches to a client-side user/channel picker instead of searching.
 * `/askai` opens the Xyne AI panel; `/record` opens the Recordings page. Recognised only at the
 * very start of the input.
 */
export type SearchCommandKind = 'call' | 'chat' | 'askai' | 'record';

export interface SearchCommandDef {
  kind: SearchCommandKind;
  /** The word typed after the leading slash. */
  word: string;
  /** Label shown in the `/` command list. */
  label: string;
}

export const SEARCH_COMMANDS: SearchCommandDef[] = [
  { kind: 'call', word: 'call', label: 'Call a person or channel' },
  { kind: 'chat', word: 'chat', label: 'Message a person or channel' },
  { kind: 'askai', word: 'askai', label: 'Ask Xyne AI' },
  { kind: 'record', word: 'record', label: 'Go to Recordings' },
];

// Leading `/call`/`/chat`/`/askai`/`/record` (case-insensitive). Group 1 = command word,
// group 2 = the argument after the first run of spaces (empty until one is typed).
const SEARCH_COMMAND_REGEX = /^\/(call|chat|askai|record)(?:[ \t]+([\s\S]*))?$/i;

/**
 * Detect a leading slash-command. Returns null unless the text starts with a complete
 * `/call`, `/chat`, `/askai`, or `/record` token. `arg` is everything after the command word.
 */
export function parseSearchCommand(text: string): { kind: SearchCommandKind; arg: string } | null {
  const match = text.match(SEARCH_COMMAND_REGEX);
  if (!match || !match[1]) return null;
  // Trim so trailing whitespace/newlines don't leak into the picker query or the `@`/`#` scope.
  return { kind: match[1].toLowerCase() as SearchCommandKind, arg: (match[2] ?? '').trim() };
}
