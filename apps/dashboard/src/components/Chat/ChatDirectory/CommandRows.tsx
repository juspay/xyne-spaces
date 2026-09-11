import { type ReactElement, type MouseEventHandler, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { CheckTickSingle } from '@xyne/icons';
import type { UserStatus, Channel } from '@xyne/shared';
import Avatar, { type AvatarSize } from '../../ui/Avatar/Avatar';
import Badge from '../../ui/Badge';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';

// Minimal user shape a command row reads. Satisfied by the slash palette's `User` rows, the cmd+K
// mention picker's candidates, and search-result users (incl. synthetic desk contacts where id = email).
export interface CommandRowUser {
  id: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
  status?: UserStatus | string | null;
}

// Custom/presence status a row forwards to StatusIndicator (search/browse rows only; the
// indicator self-guards to null when there is no valid status). Kept as data (not a prebuilt
// element) so the picker can adopt status later without each caller wiring StatusIndicator.
export interface CommandRowStatus {
  statusEmoji?: string | null;
  statusContent?: string | null;
  statusExpiryAt?: number | null;
}

// Shared cmdk-row wiring for both row types (required fields first, optional last).
export interface CommandRowBaseProps {
  value: string;
  onSelect: () => void;
  // Highlight bridge — the one behavioral difference between the two surfaces:
  //   mention picker: pass `isActive` (+ `onMouseEnter`) so the parent's manual
  //     `selectedMentionIndex` drives the `cmdk-active-row` highlight.
  //   slash palette: omit both, and cmdk's own `aria-selected` drives it.
  isActive?: boolean;
  onMouseEnter?: () => void;
  onMouseDownCapture?: MouseEventHandler;
  dataItemLabel?: string;
  // Search/browse adornments — passed only by the legacy search-row adapters
  // (ChannelCommandItem, UserSearchResultItem); picker callers omit them.
  status?: CommandRowStatus; // renders a StatusIndicator just after the name
  isSelected?: boolean; // renders the selected check at the row's trailing edge
  badgeCount?: number; // unread count → success Badge at the trailing edge; hidden when isSelected
  dataResultId?: string; // load-bearing: cmd+K keyboard-nav / selection / preview read these
  dataResultType?: string;
}

export interface UserRowProps extends CommandRowBaseProps {
  user: CommandRowUser;
  isCurrentUser?: boolean;
}

export interface ChannelRowProps extends CommandRowBaseProps {
  channel: Channel;
  label: string;
  avatarSize?: AvatarSize; // DM avatar size (default 'xs'); ContextPicker passes 'sm'
}

export interface SeeMoreRowProps {
  value: string;
  label: string;
  onSelect: () => void;
  hoverable: boolean;
  trackCategory: string;
  trackName: string;
  trackMetadata: string;
}

export interface CommandSectionProps {
  heading: string;
  children: ReactNode;
}

/**
 * One person row: avatar + name (+ "(you)") + email, with a "Deactivated" badge for INACTIVE
 * users. Shared by the slash palette, the cmd+K mention picker, and — via UserSearchResultItem —
 * user search results, which additionally pass `status` (StatusIndicator), `isSelected` (trailing
 * check) and the `data-result-*` cmd+K nav attributes.
 */
export function UserRow(props: UserRowProps): ReactElement {
  const {
    user,
    value,
    onSelect,
    isCurrentUser = false,
    status,
    isSelected = false,
    badgeCount,
    isActive,
    onMouseEnter,
    onMouseDownCapture,
    dataItemLabel,
    dataResultId,
    dataResultType,
  } = props;
  const { isMobile } = usePlatform();
  const displayName = getUserDisplayName(user);
  const isDeactivated = isUserDeactivated(user);
  const showUnreadBadge = !isSelected && (badgeCount ?? 0) > 0;

  return (
    <Command.Item
      value={value}
      data-item-label={dataItemLabel}
      {...(dataResultId ? { 'data-result-id': dataResultId } : {})}
      {...(dataResultType ? { 'data-result-type': dataResultType } : {})}
      onSelect={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseDownCapture={onMouseDownCapture}
      className={commandRowClassName(isActive, isMobile)}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <Avatar userId={user.id} size='xs' />
      <div className='flex-1 min-w-0 flex items-center gap-2'>
        <span
          className={`min-w-0 truncate text-[15px] leading-[1.2] tracking-[-0.1px] ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {displayName}
          {isCurrentUser && <span className='text-muted-foreground'> (you)</span>}
        </span>
        {!isDeactivated && status && (
          <StatusIndicator
            statusEmoji={status.statusEmoji}
            statusContent={status.statusContent}
            statusExpiryAt={status.statusExpiryAt}
            size='sm'
          />
        )}
        {isDeactivated && (
          <span className='shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
            Deactivated
          </span>
        )}
        {user.email && (
          <span className='min-w-0 truncate text-xs text-muted-foreground'>{user.email}</span>
        )}
      </div>
      {isSelected && <SelectedCheck />}
      {showUnreadBadge && (
        <Badge variant='success' className='font-mono shrink-0 text-xs px-1.5 py-0'>
          {badgeCount}
        </Badge>
      )}
    </Command.Item>
  );
}

/**
 * One channel / DM / group-DM row: the channel's glyph in a fixed column + label. The shared
 * `ChannelIcon` resolves public / private / 1:1-DM / group-DM straight from the channel. Browse
 * rows (via ChannelCommandItem) additionally pass `status` (a DM peer's presence), `badgeCount`
 * (unread), `isSelected` (trailing check) and the `data-result-*` cmd+K nav attributes.
 */
export function ChannelRow(props: ChannelRowProps): ReactElement {
  const {
    channel,
    label,
    value,
    onSelect,
    avatarSize = 'xs',
    status,
    isSelected = false,
    badgeCount,
    isActive,
    onMouseEnter,
    onMouseDownCapture,
    dataItemLabel,
    dataResultId,
    dataResultType,
  } = props;
  const { isMobile } = usePlatform();
  const showUnreadBadge = !isSelected && (badgeCount ?? 0) > 0;

  return (
    <Command.Item
      value={value}
      data-item-label={dataItemLabel}
      {...(dataResultId ? { 'data-result-id': dataResultId } : {})}
      {...(dataResultType ? { 'data-result-type': dataResultType } : {})}
      onSelect={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseDownCapture={onMouseDownCapture}
      className={commandRowClassName(isActive, isMobile)}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
        <ChannelIcon
          channel={channel}
          glyphClassName='text-muted-foreground'
          avatarSize={avatarSize}
        />
      </div>
      <div className='flex-1 min-w-0 flex items-center gap-1'>
        <span className='min-w-0 truncate text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground'>
          {label}
        </span>
        {status && (
          <StatusIndicator
            statusEmoji={status.statusEmoji}
            statusContent={status.statusContent}
            statusExpiryAt={status.statusExpiryAt}
            size='sm'
          />
        )}
      </div>
      {isSelected && <SelectedCheck />}
      {showUnreadBadge && (
        <Badge variant='success' className='font-mono shrink-0 text-xs px-1.5 py-0'>
          {badgeCount}
        </Badge>
      )}
    </Command.Item>
  );
}

/**
 * A "See N more" / "See less" affordance for a truncated result group. A cmdk item (not a button)
 * so arrow keys reach it — but deliberately no `data-item-label`, which would splice the "See N
 * more" text into the input's ghost preview. Carries `data-track-*` for search metrics.
 */
export function SeeMoreRow(props: SeeMoreRowProps): ReactElement {
  const { value, label, onSelect, hoverable, trackCategory, trackName, trackMetadata } = props;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-lg text-left cursor-pointer transition-colors select-none aria-selected:text-foreground aria-selected:bg-accent',
        hoverable && 'hover:text-foreground hover:bg-accent',
      )}
      style={{ WebkitTapHighlightColor: 'transparent' }}
      data-track-category={trackCategory}
      data-track-name={trackName}
      data-track-metadata={trackMetadata}
    >
      {label}
    </Command.Item>
  );
}

/**
 * A titled cmdk group with the standard uppercase-mono heading and consistent bottom
 * spacing (mb-4) so consecutive sections never collapse together. Callers gate on
 * non-empty results, so an empty section is never rendered (no phantom gap).
 */
export function CommandSection({ heading, children }: CommandSectionProps): ReactElement {
  return (
    <div className='mb-4'>
      <Command.Group heading={heading} className={COMMAND_SECTION_HEADING_CLASS}>
        {children}
      </Command.Group>
    </div>
  );
}

const COMMAND_ROW_BASE_CLASS = 'flex items-center gap-3 p-3 rounded-lg cursor-pointer mt-1.5';

// Standard cmdk group-heading style (uppercase mono muted) shared by every titled section.
// `font-mono` resolves to Geist Mono via the Tailwind config.
const COMMAND_SECTION_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono';

/**
 * Build the row className, bridging the two surfaces' highlight models.
 * Slash palette (`isActive` undefined): cmdk owns selection → style `aria-selected`.
 * Mention picker (`isActive` boolean): the parent tracks the active index → mark
 * `cmdk-active-row`, with desktop-only press feedback.
 * The mode is picked by whether `isActive` is passed, so slash omits it entirely: passing
 * `false` there would read as manual-inactive and drop the cmdk `aria-selected` highlight.
 */
function commandRowClassName(isActive: boolean | undefined, isMobile: boolean): string {
  if (isActive === undefined) {
    return cn(COMMAND_ROW_BASE_CLASS, 'hover:bg-accent aria-selected:bg-accent');
  }
  return cn(
    COMMAND_ROW_BASE_CLASS,
    'transition-all duration-150',
    isActive && 'cmdk-active-row',
    !isMobile && 'active:bg-muted active:scale-[0.98]',
  );
}

// Trailing "selected" pill shared by both rows (identical markup in the legacy search rows).
function SelectedCheck(): ReactElement {
  return (
    <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground'>
      <CheckTickSingle size={10} />
    </span>
  );
}
