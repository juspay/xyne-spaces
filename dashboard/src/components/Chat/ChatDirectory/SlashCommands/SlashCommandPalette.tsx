import { ReactElement, type MouseEventHandler } from 'react';
import { Command } from 'cmdk';
import { Users } from 'lucide-react';
import { COMMAND_KINDS, getCommand } from './commands';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import Avatar from '../../../ui/Avatar/Avatar';
import ChannelIcon from '../../ChannelIcon/ChannelIcon';
import type { UseSlashCommandsReturn, GotoExtra } from './useSlashCommands';

// cmdk group-heading style (uppercase mono muted) so the palette matches the menu's
// other sections.
const COMMAND_GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono';

// The whole slash-command controller is handed in as one prop. The palette reads the slice it needs
// (below); the parent no longer forwards a prop per field, so a new command that adds palette data
// touches only the hook + this file, never the parent.
interface SlashCommandPaletteProps {
  command: UseSlashCommandsReturn;
  /**
   * Primes the parent's selection-gesture ref before cmdk's synthetic onSelect,
   * so slash-command metrics can record a mouse pick as `selection_type: 'mouse'`
   * (keyboard picks are primed by the parent's keydown handler). Same contract as
   * the search result rows' `onItemMouseDown`.
   */
  onItemMouseDown?: MouseEventHandler;
}

/**
 * The slash-command palette shown inside the Cmd+K list while a `/` command is active:
 * the `/` discovery list, the `/askai` action row, or the People/Channels target picker.
 * Rendered as cmdk rows; selection (aria-selected) is driven imperatively by the parent,
 * which relies on the `data-item-label` / `data-command-word` / `value` attributes here.
 */
export function SlashCommandPalette({
  command,
  onItemMouseDown,
}: SlashCommandPaletteProps): ReactElement | null {
  const {
    commandKind,
    commandText,
    commandTarget,
    commandUserResults,
    commandChannelResults,
    commandGroupDmResults,
    commandNavResults,
    currentUserID,
    commandGotoExtras,
    applyCommand: onApplyCommand,
    runActionCommand: onRunAction,
    runNavSection: onRunNavSection,
    runGotoExtra: onRunGotoExtra,
    runCommandTarget: onRunTarget,
    setActiveCommandWord: onHoverCommand,
  } = command;
  // Compose / call-confirm render their own UI (overlay), not this palette.
  if (commandTarget) return null;

  // `/` discovery: just a slash or an unrecognized command → list the commands.
  if (commandKind === null) {
    const typed = commandText.slice(1).toLowerCase();
    const matches = COMMAND_KINDS.filter(k => k.startsWith(typed));
    // A non-empty prefix that matches nothing (e.g. `/xyz`) shows a no-match state rather than
    // every command; a bare `/` (empty prefix) still lists them all.
    if (typed && matches.length === 0) {
      return (
        <div className='py-6 text-center text-sm text-muted-foreground'>No matching commands</div>
      );
    }
    const shown = matches.length ? matches : COMMAND_KINDS;
    return (
      <Command.Group heading='Commands' className={COMMAND_GROUP_HEADING_CLASS}>
        {shown.map(kind => {
          const def = getCommand(kind);
          return (
            <Command.Item
              key={kind}
              value={`command-${kind}`}
              data-item-label={`/${kind}`}
              data-command-word={kind}
              onSelect={() => (def.type === 'action' ? onRunAction(kind) : onApplyCommand(kind))}
              onMouseDownCapture={onItemMouseDown}
              onMouseEnter={() => onHoverCommand(kind)}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
                <def.icon size={15} />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-sm font-semibold text-foreground truncate'>/{kind}</div>
                <div className='text-xs text-muted-foreground truncate'>{def.label}</div>
              </div>
            </Command.Item>
          );
        })}
      </Command.Group>
    );
  }

  // Action commands (`/askai`, `/record`): no target picker — one row that runs the action.
  const activeDef = getCommand(commandKind);
  if (activeDef.type === 'action') {
    return (
      <Command.Group heading={activeDef.heading} className={COMMAND_GROUP_HEADING_CLASS}>
        <Command.Item
          value={`command-${commandKind}`}
          data-item-label={activeDef.title}
          onSelect={() => onRunAction(commandKind)}
          onMouseDownCapture={onItemMouseDown}
          className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
        >
          <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
            <activeDef.icon size={15} />
          </div>
          <div className='flex-1 min-w-0'>
            <div className='font-semibold text-sm truncate text-foreground'>{activeDef.title}</div>
            <div className='text-xs text-muted-foreground truncate'>{activeDef.description}</div>
          </div>
        </Command.Item>
      </Command.Group>
    );
  }

  // `/goto`: list the nav-bar sections; picking one routes there. Same row markup +
  // `data-item-label` contract as the pickers, so arrow-nav / Enter / ghost-sync all work through
  // the parent unchanged.
  if (activeDef.type === 'goto') {
    if (commandNavResults.length === 0 && commandGotoExtras.length === 0) {
      return (
        <div className='py-6 text-center text-sm text-muted-foreground'>No matching sections</div>
      );
    }
    // Pinned extras (e.g. Threads) render above the nav sections — they're
    // destinations, not settings; the rest (Preferences/Profile) stay below.
    const pinnedExtras = commandGotoExtras.filter(extra => extra.pinTop);
    const settingsExtras = commandGotoExtras.filter(extra => !extra.pinTop);
    const renderExtra = (extra: GotoExtra): ReactElement => (
      <Command.Item
        key={extra.id}
        value={`goto-${extra.id}`}
        data-item-label={extra.label}
        onSelect={() => onRunGotoExtra(extra)}
        onMouseDownCapture={onItemMouseDown}
        className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
      >
        <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
          <extra.icon size={15} />
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-sm font-semibold text-foreground truncate'>{extra.label}</div>
        </div>
      </Command.Item>
    );
    return (
      <>
        {(pinnedExtras.length > 0 || commandNavResults.length > 0) && (
          <Command.Group heading={activeDef.heading} className={COMMAND_GROUP_HEADING_CLASS}>
            {pinnedExtras.map(renderExtra)}
            {commandNavResults.map(item => (
              <Command.Item
                key={item.path}
                value={`goto-${item.path}`}
                data-item-label={item.label}
                onSelect={() => onRunNavSection(item)}
                onMouseDownCapture={onItemMouseDown}
                className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
              >
                <div className='flex items-center justify-center size-7 rounded-md bg-muted text-foreground shrink-0'>
                  <item.icon size={item.iconSize ?? 15} />
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-semibold text-foreground truncate'>{item.label}</div>
                </div>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {settingsExtras.length > 0 && (
          <Command.Group heading='Settings' className={COMMAND_GROUP_HEADING_CLASS}>
            {settingsExtras.map(renderExtra)}
          </Command.Group>
        )}
      </>
    );
  }

  // Picker: choose a person, channel or group DM to call / message.
  if (
    commandUserResults.length === 0 &&
    commandChannelResults.length === 0 &&
    commandGroupDmResults.length === 0
  ) {
    return <div className='py-6 text-center text-sm text-muted-foreground'>No matches</div>;
  }
  return (
    <>
      {commandUserResults.length > 0 && (
        <Command.Group heading='Users' className={COMMAND_GROUP_HEADING_CLASS}>
          {commandUserResults.map(user => (
            <Command.Item
              key={user.id}
              value={`command-user-${user.id}`}
              data-item-label={getUserDisplayName(user)}
              onSelect={() => onRunTarget({ type: 'user', user })}
              onMouseDownCapture={onItemMouseDown}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <Avatar userId={user.id} size='sm' />
              <div className='flex-1 min-w-0'>
                <div className='font-semibold text-sm truncate text-foreground'>
                  {getUserDisplayName(user)}
                  {user.id === currentUserID && (
                    <span className='text-muted-foreground font-normal'> (you)</span>
                  )}
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
              onMouseDownCapture={onItemMouseDown}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <div className='flex items-center justify-center size-7 rounded-md bg-muted text-muted-foreground shrink-0'>
                <ChannelIcon channel={channel} />
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
      {commandGroupDmResults.length > 0 && (
        <Command.Group heading='Group DMs' className={COMMAND_GROUP_HEADING_CLASS}>
          {commandGroupDmResults.map(({ channel, label }) => (
            <Command.Item
              key={channel.id}
              value={`command-group-dm-${channel.id}`}
              data-item-label={label}
              onSelect={() =>
                onRunTarget({ type: 'channel', channel, displayName: label, isDm: true })
              }
              onMouseDownCapture={onItemMouseDown}
              className='flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1'
            >
              <div className='flex items-center justify-center size-7 rounded-md bg-muted text-muted-foreground shrink-0'>
                <Users size={14} />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='font-semibold text-sm truncate text-foreground'>{label}</div>
              </div>
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

export default SlashCommandPalette;
