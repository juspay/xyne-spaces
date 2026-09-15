import { useMemo, useState } from 'react';
import { ChannelType, UserType } from '@xyne/shared';
import {
  Bot,
  Hash,
  Folder,
  Layers,
  ListOrdered,
  Mail,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import { useActiveUserSearch, useUser, useUsers } from '../../../../hooks/useUsers';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import { useAllChannels, useChannel } from '../../../../hooks/useChannels';
import UserAvatar, { AvatarShape, AvatarSize } from '../../../UserAvatar/UserAvatar';
import { EntitySelector } from '../../../ui/EntitySelector/EntitySelector';
import { EntityMultiSelector } from '../../../ui/EntitySelector/EntityMultiSelector';
import type { SelectorOption } from '../../../ui/EntitySelector/EntitySelector.types';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { EntityKind } from './SchemaForm.utils';

interface EntityFieldProps {
  kind: EntityKind;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
}

export function EntityField({
  kind,
  value,
  onChange,
  placeholder,
}: EntityFieldProps): React.ReactElement {
  if (kind === EntityKind.USER) {
    return (
      <UserField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a user'}
      />
    );
  }
  if (kind === EntityKind.USER_GROUP) {
    return (
      <UserGroupField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a user group'}
      />
    );
  }
  if (kind === EntityKind.CHANNEL) {
    return (
      <ChannelField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a channel'}
      />
    );
  }
  if (kind === EntityKind.BOARD) {
    return (
      <BoardField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a board'}
      />
    );
  }
  if (kind === EntityKind.STAGE) {
    return (
      <StageField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a stage'}
      />
    );
  }
  if (kind === EntityKind.SENDER) {
    return (
      <SenderField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a sender'}
      />
    );
  }
  if (kind === EntityKind.PROJECT) {
    return (
      <ProjectField
        value={value ?? null}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick a project'}
      />
    );
  }

  return (
    <OpaqueIdField
      value={value ?? null}
      onChange={onChange}
      {...(placeholder !== undefined && { placeholder })}
    />
  );
}

function OpaqueIdField({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (next: string | undefined) => void;
  placeholder?: string;
}): React.ReactElement {
  return (
    <input
      type='text'
      value={value ?? ''}
      onChange={e => onChange(e.target.value.length > 0 ? e.target.value : undefined)}
      placeholder={placeholder}
      data-track-category='automation-builder'
      data-track-name='entity-opaque-id-input'
      className='h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40'
    />
  );
}

interface FieldProps {
  value: string | null;
  onChange: (next: string | undefined) => void;
  placeholder: string;
}

function prependSelectedOption<T extends { id: string }>(
  value: string | null | undefined,
  source: ReadonlyArray<T> | undefined,
  baseOptions: SelectorOption[],
  makeOption: (item: T) => SelectorOption,
): SelectorOption[] {
  if (!value || !source) return baseOptions;
  if (baseOptions.some(o => o.value === value)) return baseOptions;
  const selected = source.find(item => item.id === value);
  if (!selected) return baseOptions;
  return [makeOption(selected), ...baseOptions];
}

function UserField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const users = useActiveUserSearch(search, 15);
  const selectedUser = useUser(value ?? '');

  const baseOptions: SelectorOption[] = useMemo(() => {
    if (!users) return [];
    return users.map(u => ({
      value: u.id,
      label: getUserDisplayName(u),
      subtitle: u.email,
      icon: <UserAvatar userId={u.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
    }));
  }, [users]);

  const options = useMemo(() => {
    if (!value || !selectedUser) return baseOptions;
    if (baseOptions.some(o => o.value === value)) return baseOptions;
    return [
      {
        value: selectedUser.id,
        label: getUserDisplayName(selectedUser),
        subtitle: selectedUser.email,
        icon: (
          <UserAvatar userId={selectedUser.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
        ),
      },
      ...baseOptions,
    ];
  }, [baseOptions, selectedUser, value]);

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search users…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function UserGroupField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const groups = useUserGroups();

  const baseOptions: SelectorOption[] = useMemo(() => {
    if (!groups) return [];
    const lower = search.trim().toLowerCase();
    return groups
      .filter(g => g.isActive !== false)
      .filter(g => (lower ? g.name.toLowerCase().includes(lower) : true))
      .map(g => ({
        value: g.id,
        label: g.name,
        icon: <Users className='size-4 text-muted-foreground' />,
      }));
  }, [groups, search]);

  const options = useMemo(
    () =>
      prependSelectedOption(value, groups, baseOptions, g => ({
        value: g.id,
        label: g.name,
        icon: <Users className='size-4 text-muted-foreground' />,
      })),
    [baseOptions, groups, value],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search groups…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function channelIcon(type: string | null | undefined): React.ReactElement {
  return type === ChannelType.EMAIL ? (
    <Mail className='size-4 text-muted-foreground' />
  ) : (
    <Hash className='size-4 text-muted-foreground' />
  );
}

function ChannelField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const channels = useAllChannels();
  const selectedChannel = useChannel(value ?? '');

  const baseOptions: SelectorOption[] = useMemo(() => {
    if (!channels) return [];
    const lower = search.trim().toLowerCase();
    return channels
      .filter(c => (lower ? (c.name ?? '').toLowerCase().includes(lower) : true))
      .map(c => ({
        value: c.id,
        label: c.name || '(unnamed channel)',
        icon: channelIcon(c.type),
      }));
  }, [channels, search]);

  const options = useMemo(() => {
    if (!value || !selectedChannel) return baseOptions;
    if (baseOptions.some(o => o.value === value)) return baseOptions;
    return [
      {
        value: selectedChannel.id,
        label: selectedChannel.name || '(unnamed channel)',
        icon: channelIcon(selectedChannel.type),
      },
      ...baseOptions,
    ];
  }, [baseOptions, selectedChannel, value]);

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search channels…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function BoardField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [boards] = useCachedQuery(queries.getAllBoardsList());

  const baseOptions: SelectorOption[] = useMemo(() => {
    if (!boards) return [];
    const lower = search.trim().toLowerCase();
    return boards
      .filter(b => (lower ? b.name.toLowerCase().includes(lower) : true))
      .map(b => ({
        value: b.id,
        label: b.name,
        icon: <Layers className='size-4 text-muted-foreground' />,
      }));
  }, [boards, search]);

  const options = useMemo(
    () =>
      prependSelectedOption(value, boards, baseOptions, b => ({
        value: b.id,
        label: b.name,
        icon: <Layers className='size-4 text-muted-foreground' />,
      })),
    [baseOptions, boards, value],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search boards…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function SenderField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const users = useUsers();
  const selectedUser = useUser(value ?? '');

  const options: SelectorOption[] = useMemo(() => {
    const lower = search.trim().toLowerCase();
    const matches = (label: string): boolean =>
      lower.length === 0 || label.toLowerCase().includes(lower);

    const out: SelectorOption[] = [];
    // Automations may only post as a non-human (bot/app) identity — humans are
    // rejected by the backend send/reply steps (impersonation). So the picker
    // offers bot and app/agent accounts only, never a human user.
    for (const u of users) {
      if (u.userType !== UserType.BOT && u.userType !== UserType.APP) continue;
      const label = getUserDisplayName(u);
      if (!matches(label) && !matches(u.email ?? '')) continue;
      out.push({
        value: u.id,
        label,
        subtitle: u.email ?? 'system bot',
        icon: <Bot className='size-4 text-muted-foreground' />,
      });
    }
    return out;
  }, [users, search]);

  const optionsWithSelected = useMemo(() => {
    if (!value || !selectedUser) return options;
    if (options.some(o => o.value === value)) return options;
    return [
      {
        value: selectedUser.id,
        label: getUserDisplayName(selectedUser),
        subtitle: selectedUser.email ?? undefined,
        icon:
          selectedUser.userType === UserType.BOT || selectedUser.userType === UserType.APP ? (
            <Bot className='size-4 text-muted-foreground' />
          ) : (
            <UserAvatar
              userId={selectedUser.id}
              size={AvatarSize.SM}
              shape={AvatarShape.CIRCULAR}
            />
          ),
      },
      ...options,
    ];
  }, [options, selectedUser, value]);

  return (
    <EntitySelector
      options={optionsWithSelected}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search bots…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function StageField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const boardIds = useMemo(() => (boards ?? []).map(b => b.id), [boards]);
  const [stages] = useCachedQuery(queries.getStagesByBoardIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });

  const options: SelectorOption[] = useMemo(() => {
    if (!stages || !boards) return [];
    const boardNameById = new Map(boards.map(b => [b.id, b.name]));
    const byName = new Map<string, string[]>();
    for (const s of stages) {
      const list = byName.get(s.name) ?? [];
      const boardName = boardNameById.get(s.boardId);
      if (boardName) list.push(boardName);
      byName.set(s.name, list);
    }
    const lower = search.trim().toLowerCase();
    return Array.from(byName.entries())
      .filter(([name]) => (lower ? name.toLowerCase().includes(lower) : true))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, boardNames]) => {
        const unique = Array.from(new Set(boardNames));
        const subtitle =
          unique.length === 0
            ? undefined
            : unique.length === 1
              ? `On ${unique[0]}`
              : `On ${unique.length} boards`;
        return {
          value: name,
          label: name,
          ...(subtitle ? { subtitle } : {}),
          icon: <ListOrdered className='size-4 text-muted-foreground' />,
        };
      });
  }, [stages, boards, search]);

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search stages…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

function ProjectField({ value, onChange, placeholder }: FieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [projects] = useCachedQuery(queries.getAllProjects());

  const baseOptions: SelectorOption[] = useMemo(() => {
    if (!projects) return [];
    const lower = search.trim().toLowerCase();
    return projects
      .filter(p => (lower ? p.name.toLowerCase().includes(lower) : true))
      .map(p => ({
        value: p.id,
        label: p.name,
        icon: <Folder className='size-4 text-muted-foreground' />,
      }));
  }, [projects, search]);

  const options = useMemo(
    () =>
      prependSelectedOption(value, projects, baseOptions, p => ({
        value: p.id,
        label: p.name,
        icon: <Folder className='size-4 text-muted-foreground' />,
      })),
    [baseOptions, projects, value],
  );

  return (
    <EntitySelector
      options={options}
      selectedValue={value}
      onSelect={next => onChange(next ?? undefined)}
      placeholder={placeholder}
      searchPlaceholder='Search projects…'
      onSearchChange={setSearch}
      disableClientFiltering
      showClearButton
    />
  );
}

export { UserIcon };

interface MultiEntityFieldProps {
  kind: EntityKind;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function MultiEntityField({
  kind,
  value,
  onChange,
  placeholder,
}: MultiEntityFieldProps): React.ReactElement {
  if (kind === EntityKind.USER) {
    return (
      <MultiUsers value={value} onChange={onChange} placeholder={placeholder ?? 'Pick users'} />
    );
  }
  if (kind === EntityKind.USER_GROUP) {
    return (
      <MultiUserGroups
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick user groups'}
      />
    );
  }
  if (kind === EntityKind.CHANNEL) {
    return (
      <MultiChannels
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'Pick channels'}
      />
    );
  }
  if (kind === EntityKind.BOARD) {
    return (
      <MultiBoards value={value} onChange={onChange} placeholder={placeholder ?? 'Pick boards'} />
    );
  }
  return (
    <MultiProjects value={value} onChange={onChange} placeholder={placeholder ?? 'Pick projects'} />
  );
}

interface MultiFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

function MultiUsers({ value, onChange, placeholder }: MultiFieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const users = useActiveUserSearch(search, 30);
  const options: SelectorOption[] = useMemo(() => {
    if (!users) return [];
    return users.map(u => ({
      value: u.id,
      label: getUserDisplayName(u),
      subtitle: u.email,
      icon: <UserAvatar userId={u.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
    }));
  }, [users]);
  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder={placeholder}
      searchPlaceholder='Search users…'
      onSearchChange={setSearch}
      disableClientFiltering
    />
  );
}

function MultiUserGroups({ value, onChange, placeholder }: MultiFieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const groups = useUserGroups();
  const options: SelectorOption[] = useMemo(() => {
    if (!groups) return [];
    const lower = search.trim().toLowerCase();
    return groups
      .filter(g => g.isActive !== false)
      .filter(g => (lower ? g.name.toLowerCase().includes(lower) : true))
      .map(g => ({
        value: g.id,
        label: g.name,
        icon: <Users className='size-4 text-muted-foreground' />,
      }));
  }, [groups, search]);
  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder={placeholder}
      searchPlaceholder='Search groups…'
      onSearchChange={setSearch}
      disableClientFiltering
    />
  );
}

function MultiChannels({ value, onChange, placeholder }: MultiFieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const channels = useAllChannels();
  const options: SelectorOption[] = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name?: string | null; type: string | null | undefined }
    >();
    for (const c of channels ?? []) byId.set(c.id, { id: c.id, name: c.name, type: c.type });
    const lower = search.trim().toLowerCase();
    const base = Array.from(byId.values())
      .filter(c => (lower ? (c.name ?? '').toLowerCase().includes(lower) : true))
      .map(c => ({
        value: c.id,
        label: c.name || '(unnamed channel)',
        icon: channelIcon(c.type),
      }));
    const present = new Set(base.map(o => o.value));
    const selectedExtra: SelectorOption[] = value
      .filter(v => !present.has(v))
      .map(v => {
        const c = byId.get(v);
        return {
          value: v,
          label: c?.name || v,
          icon: channelIcon(c?.type),
        };
      });
    return [...selectedExtra, ...base];
  }, [channels, search, value]);
  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder={placeholder}
      searchPlaceholder='Search channels…'
      onSearchChange={setSearch}
      disableClientFiltering
    />
  );
}

function MultiBoards({ value, onChange, placeholder }: MultiFieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [boards] = useCachedQuery(queries.getAllBoardsList());
  const options: SelectorOption[] = useMemo(() => {
    if (!boards) return [];
    const lower = search.trim().toLowerCase();
    return boards
      .filter(b => (lower ? b.name.toLowerCase().includes(lower) : true))
      .map(b => ({
        value: b.id,
        label: b.name,
        icon: <Layers className='size-4 text-muted-foreground' />,
      }));
  }, [boards, search]);
  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder={placeholder}
      searchPlaceholder='Search boards…'
      onSearchChange={setSearch}
      disableClientFiltering
    />
  );
}

function MultiProjects({ value, onChange, placeholder }: MultiFieldProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [projects] = useCachedQuery(queries.getAllProjects());
  const options: SelectorOption[] = useMemo(() => {
    if (!projects) return [];
    const lower = search.trim().toLowerCase();
    return projects
      .filter(p => (lower ? p.name.toLowerCase().includes(lower) : true))
      .map(p => ({
        value: p.id,
        label: p.name,
        icon: <Folder className='size-4 text-muted-foreground' />,
      }));
  }, [projects, search]);
  return (
    <EntityMultiSelector
      options={options}
      selectedValues={value}
      onMultiSelect={onChange}
      placeholder={placeholder}
      searchPlaceholder='Search projects…'
      onSearchChange={setSearch}
      disableClientFiltering
    />
  );
}
