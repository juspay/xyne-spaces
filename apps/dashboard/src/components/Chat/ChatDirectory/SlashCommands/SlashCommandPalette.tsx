import { ReactElement, type MouseEventHandler } from 'react';
import { Command } from 'cmdk';
import { COMMAND_KINDS, getCommand } from './commands';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { UserRow, ChannelRow, CommandSection } from '../CommandRows';
import type { UseSlashCommandsReturn, GotoExtra } from './useSlashCommands';

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
      <CommandSection heading='Commands'>
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
              className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
            >
              <div className='flex-1 min-w-0 flex items-center gap-1.5 text-[15px] leading-[1.2] tracking-[-0.1px]'>
                <span className='shrink-0 text-foreground'>/{kind}</span>
                <span className='min-w-0 truncate text-muted-foreground'>{def.label}</span>
              </div>
            </Command.Item>
          );
        })}
      </CommandSection>
    );
  }

  // Action commands (`/askai`, `/record`): no target picker — one row that runs the action.
  const activeDef = getCommand(commandKind);
  if (activeDef.type === 'action') {
    return (
      <CommandSection heading={activeDef.heading}>
        <Command.Item
          value={`command-${commandKind}`}
          data-item-label={activeDef.title}
          onSelect={() => onRunAction(commandKind)}
          onMouseDownCapture={onItemMouseDown}
          className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
        >
          <activeDef.icon size={16} className='shrink-0 text-muted-foreground' />
          <div className='flex-1 min-w-0 flex items-center gap-1.5 text-[15px] leading-[1.2] tracking-[-0.1px]'>
            <span className='shrink-0 text-foreground'>{activeDef.title}</span>
            <span className='min-w-0 truncate text-muted-foreground'>{activeDef.description}</span>
          </div>
        </Command.Item>
      </CommandSection>
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
        className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
      >
        <extra.icon size={16} className='shrink-0 text-muted-foreground' />
        <div className='flex-1 min-w-0 text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
          {extra.label}
        </div>
      </Command.Item>
    );
    return (
      <>
        {(pinnedExtras.length > 0 || commandNavResults.length > 0) && (
          <CommandSection heading={activeDef.heading}>
            {pinnedExtras.map(renderExtra)}
            {commandNavResults.map(item => (
              <Command.Item
                key={item.path}
                value={`goto-${item.path}`}
                data-item-label={item.label}
                onSelect={() => onRunNavSection(item)}
                onMouseDownCapture={onItemMouseDown}
                className='flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent aria-selected:bg-accent mt-1.5'
              >
                <item.icon size={item.iconSize ?? 16} className='shrink-0 text-muted-foreground' />
                <div className='flex-1 min-w-0 text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                  {item.label}
                </div>
              </Command.Item>
            ))}
          </CommandSection>
        )}
        {settingsExtras.length > 0 && (
          <CommandSection heading='Settings'>{settingsExtras.map(renderExtra)}</CommandSection>
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
  // Primes the parent's selection-gesture ref on mouse pick; omitted when the parent didn't supply it.
  const mouseDownProps = onItemMouseDown ? { onMouseDownCapture: onItemMouseDown } : {};
  return (
    <>
      {commandUserResults.length > 0 && (
        <CommandSection heading='Users'>
          {commandUserResults.map(user => (
            <UserRow
              key={user.id}
              user={user}
              value={`command-user-${user.id}`}
              dataItemLabel={getUserDisplayName(user)}
              isCurrentUser={user.id === currentUserID}
              onSelect={() => onRunTarget({ type: 'user', user })}
              {...mouseDownProps}
            />
          ))}
        </CommandSection>
      )}
      {commandChannelResults.length > 0 && (
        <CommandSection heading='Channels'>
          {commandChannelResults.map(channel => (
            <ChannelRow
              key={channel.id}
              value={`command-channel-${channel.id}`}
              dataItemLabel={channel.name}
              label={channel.name}
              channel={channel}
              onSelect={() => onRunTarget({ type: 'channel', channel })}
              {...mouseDownProps}
            />
          ))}
        </CommandSection>
      )}
      {commandGroupDmResults.length > 0 && (
        <CommandSection heading='Group DMs'>
          {commandGroupDmResults.map(({ channel, label }) => (
            <ChannelRow
              key={channel.id}
              value={`command-group-dm-${channel.id}`}
              dataItemLabel={label}
              label={label}
              channel={channel}
              onSelect={() =>
                onRunTarget({ type: 'channel', channel, displayName: label, isDm: true })
              }
              {...mouseDownProps}
            />
          ))}
        </CommandSection>
      )}
    </>
  );
}

export default SlashCommandPalette;
