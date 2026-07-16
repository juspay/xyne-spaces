import { ReactElement } from 'react';
import { Command } from 'cmdk';
import { Phone, Sparkles, MessageSquare, Hash, Mic } from 'lucide-react';
import type { User, Channel } from '@xyne/shared';
import { SEARCH_COMMANDS, type SearchCommandKind } from './commands';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import Avatar from '../../../ui/Avatar/Avatar';
import type { CommandTarget } from './QuickDmComposer';

// cmdk group-heading style (uppercase mono muted) so the palette matches the menu's
// other sections.
const COMMAND_GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono';

// Icon for each command in the `/` discovery list.
function commandIcon(kind: SearchCommandKind): ReactElement {
  switch (kind) {
    case 'call':
      return <Phone size={15} />;
    case 'chat':
      return <MessageSquare size={15} />;
    case 'askai':
      return <Sparkles size={15} />;
    case 'record':
      return <Mic size={15} />;
  }
}

interface SlashCommandPaletteProps {
  commandKind: SearchCommandKind | null;
  commandText: string;
  commandTarget: CommandTarget | null;
  commandUserResults: User[];
  commandChannelResults: Channel[];
  onApplyCommand: (word: string) => void;
  onOpenAskAI: () => void;
  onOpenRecordings: () => void;
  onRunTarget: (target: CommandTarget) => void;
  onHoverCommand: (word: string) => void;
}

/**
 * The slash-command palette shown inside the Cmd+K list while a `/` command is active:
 * the `/` discovery list, the `/askai` action row, or the People/Channels target picker.
 * Rendered as cmdk rows; selection (aria-selected) is driven imperatively by the parent,
 * which relies on the `data-item-label` / `data-command-word` / `value` attributes here.
 */
export function SlashCommandPalette({
  commandKind,
  commandText,
  commandTarget,
  commandUserResults,
  commandChannelResults,
  onApplyCommand,
  onOpenAskAI,
  onOpenRecordings,
  onRunTarget,
  onHoverCommand,
}: SlashCommandPaletteProps): ReactElement | null {
  // Compose / call-confirm render their own UI (overlay), not this palette.
  if (commandTarget) return null;

  // `/` discovery: just a slash or an unrecognized command → list the commands.
  if (commandKind === null) {
    const typed = commandText.slice(1).toLowerCase();
    const matches = SEARCH_COMMANDS.filter(c => c.word.startsWith(typed));
    // A non-empty prefix that matches nothing (e.g. `/xyz`) shows a no-match state rather than
    // every command; a bare `/` (empty prefix) still lists them all.
    if (typed && matches.length === 0) {
      return (
        <div className='py-6 text-center text-sm text-muted-foreground'>No matching commands</div>
      );
    }
    const shown = matches.length ? matches : SEARCH_COMMANDS;
    return (
      <Command.Group heading='Commands' className={COMMAND_GROUP_HEADING_CLASS}>
        {shown.map(cmd => (
          <Command.Item
            key={cmd.word}
            value={`command-${cmd.word}`}
            data-item-label={`/${cmd.word}`}
            data-command-word={cmd.word}
            onSelect={() => {
              if (cmd.kind === 'askai') {
                onOpenAskAI();
              } else if (cmd.kind === 'record') {
                onOpenRecordings();
              } else {
                onApplyCommand(cmd.word);
              }
            }}
            onMouseEnter={() => onHoverCommand(cmd.word)}
            className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
          >
            <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
              {commandIcon(cmd.kind)}
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-semibold text-foreground truncate'>/{cmd.word}</div>
              <div className='text-xs text-muted-foreground truncate'>{cmd.label}</div>
            </div>
          </Command.Item>
        ))}
      </Command.Group>
    );
  }

  // `/askai`: no target picker — a single action row that opens the Xyne AI panel.
  if (commandKind === 'askai') {
    return (
      <Command.Group heading='Ask AI' className={COMMAND_GROUP_HEADING_CLASS}>
        <Command.Item
          value='command-askai'
          data-item-label='Ask Xyne AI'
          onSelect={() => onOpenAskAI()}
          className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
            <Sparkles size={15} />
          </div>
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-sm truncate text-foreground'>Ask Xyne AI</div>
            <div className='text-xs text-muted-foreground truncate'>Open the Xyne AI panel</div>
          </div>
        </Command.Item>
      </Command.Group>
    );
  }

  // `/record`: no target picker — a single action row that opens the Recordings page.
  if (commandKind === 'record') {
    return (
      <Command.Group heading='Recordings' className={COMMAND_GROUP_HEADING_CLASS}>
        <Command.Item
          value='command-record'
          data-item-label='Recordings'
          onSelect={() => onOpenRecordings()}
          className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
            <Mic size={15} />
          </div>
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-sm truncate text-foreground'>Recordings</div>
            <div className='text-xs text-muted-foreground truncate'>View your recordings</div>
          </div>
        </Command.Item>
      </Command.Group>
    );
  }

  // Picker: choose a person or channel to call / message.
  if (commandUserResults.length === 0 && commandChannelResults.length === 0) {
    return <div className='py-6 text-center text-sm text-muted-foreground'>No matches</div>;
  }
  return (
    <>
      {commandUserResults.length > 0 && (
        <Command.Group heading='People' className={COMMAND_GROUP_HEADING_CLASS}>
          {commandUserResults.map(user => (
            <Command.Item
              key={user.id}
              value={`command-user-${user.id}`}
              data-item-label={getUserDisplayName(user)}
              onSelect={() => onRunTarget({ type: 'user', user })}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <Avatar userId={user.id} size='sm' />
              <div className='flex-1 min-w-0'>
                <div className='font-semibold text-sm truncate text-foreground'>
                  {getUserDisplayName(user)}
                </div>
                <div className='text-xs text-muted-foreground truncate'>{user.email}</div>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}
      {commandChannelResults.length > 0 && (
        <Command.Group heading='Channels' className={COMMAND_GROUP_HEADING_CLASS}>
          {commandChannelResults.map(channel => (
            <Command.Item
              key={channel.id}
              value={`command-channel-${channel.id}`}
              data-item-label={channel.name}
              onSelect={() => onRunTarget({ type: 'channel', channel })}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <div className='flex items-center justify-center size-7 rounded-md bg-muted text-muted-foreground shrink-0'>
                <Hash size={14} />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='font-semibold text-sm truncate text-foreground'>{channel.name}</div>
                {channel.description && (
                  <div className='text-xs text-muted-foreground truncate'>
                    {channel.description}
                  </div>
                )}
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

export default SlashCommandPalette;
