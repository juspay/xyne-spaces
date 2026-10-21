import { useState, type ReactElement } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import {
  Check,
  ChevronRight,
  CircleHelp,
  Link2,
  Plug,
  SlidersHorizontal,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { DASHBOARD_ORIGIN } from '@/src/config';
import {
  MCP_FILTER_OPTIONS,
  mcpInitials,
  type McpBrowseFilter,
  type McpBrowseItem,
  type McpBrowseSection,
} from '@/src/utils/mcpBrowse';

const MCP_ICON_PATHS = (type: string): string[] => [
  `${DASHBOARD_ORIGIN}/assets/mcp/${type}.png`,
  `${DASHBOARD_ORIGIN}/claw/assets/mcp/${type}.png`,
];

const McpIcon = ({ item, size = 36 }: { item: McpBrowseItem; size?: number }): ReactElement => {
  const [pathIndex, setPathIndex] = useState(0);
  const paths = MCP_ICON_PATHS(item.type);
  const uri = paths[pathIndex];

  if (!uri) {
    return (
      <View
        className='items-center justify-center rounded-lg border border-border bg-muted'
        style={{ width: size, height: size }}
      >
        <Text className='text-[11px] font-semibold text-foreground'>{mcpInitials(item.name)}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      onError={() => setPathIndex(current => current + 1)}
      style={{ width: size, height: size, borderRadius: 8 }}
    />
  );
};

export const McpBrowseRow = ({
  item,
  onPress,
}: {
  item: McpBrowseItem;
  onPress: () => void;
}): ReactElement => {
  const chevron = useCSSVariable('--color-foreground') as string;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={item.name}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 10,
      }}
    >
      <McpIcon item={item} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text className='text-sm font-semibold text-foreground' numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text className='text-sm text-flow-card-header-title' numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={16} color={chevron} />
    </Pressable>
  );
};

export const McpBrowseToolbar = ({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: McpBrowseFilter;
  onFilterChange: (value: McpBrowseFilter) => void;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const icon = useCSSVariable('--color-foreground') as string;

  return (
    <View style={{ zIndex: 2, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={search}
          onChangeText={onSearchChange}
          placeholder='Search'
          placeholderTextColor='#94A3B8'
          autoCorrect={false}
          autoCapitalize='none'
          className='min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground'
        />
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Filter MCPs'
          onPress={() => setOpen(current => !current)}
          className='size-10 items-center justify-center rounded-xl border border-border bg-card'
        >
          <SlidersHorizontal size={16} color={icon} />
        </Pressable>
      </View>
      {open ? (
        <View className='absolute right-0 top-12 z-10 overflow-hidden rounded-xl border border-border bg-card'>
          {MCP_FILTER_OPTIONS.map(option => {
            const selected = filter === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole='menuitem'
                accessibilityState={{ selected }}
                onPress={() => {
                  onFilterChange(option.id);
                  setOpen(false);
                }}
                className={selected ? 'bg-muted px-3 py-2.5' : 'px-3 py-2.5'}
              >
                <Text className='text-sm text-foreground'>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

export const McpBrowseSections = ({
  sections,
  onOpen,
}: {
  sections: McpBrowseSection[];
  onOpen: (item: McpBrowseItem) => void;
}): ReactElement => (
  <View style={{ gap: 24 }}>
    {sections.map(section => (
      <View key={section.id} style={{ gap: 4 }}>
        <Text className='px-1 text-sm font-semibold text-foreground'>{section.label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
          {section.items.map(item => (
            <View key={item.id} style={{ width: '50%', paddingHorizontal: 4 }}>
              <McpBrowseRow item={item} onPress={() => onOpen(item)} />
            </View>
          ))}
        </View>
      </View>
    ))}
  </View>
);

const Badge = ({
  label,
  tone,
}: {
  label: string;
  tone: 'sky' | 'muted' | 'green';
}): ReactElement => {
  const bg =
    tone === 'sky'
      ? 'rgba(14, 165, 233, 0.14)'
      : tone === 'green'
        ? 'rgba(16, 185, 129, 0.16)'
        : 'rgba(148, 163, 184, 0.16)';
  const fg = tone === 'sky' ? '#38BDF8' : tone === 'green' ? '#34D399' : '#94A3B8';
  return (
    <View className='rounded-full px-2 py-0.5' style={{ backgroundColor: bg }}>
      <Text className='text-[11px] font-medium' style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
};

export const McpDetailView = ({
  item,
  selectedIds,
  canEdit,
  onToggleTool,
  onToggleAll,
  onConnect,
}: {
  item: McpBrowseItem;
  selectedIds: string[];
  canEdit: boolean;
  onToggleTool: (id: string) => void;
  onToggleAll: (selectAll: boolean) => void;
  onConnect?: () => void;
}): ReactElement => {
  const iconColor = useCSSVariable('--color-foreground') as string;
  const selectedSet = new Set(selectedIds);
  const selectedCount = item.tools.filter(tool => selectedSet.has(tool.id)).length;
  const allSelected = item.tools.length > 0 && selectedCount === item.tools.length;

  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <McpIcon item={item} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text className='text-base font-semibold text-foreground'>{item.name}</Text>
            <Badge label={item.scope} tone='sky' />
            <Badge
              label={item.connected ? 'Connected' : 'Not connected'}
              tone={item.connected ? 'green' : 'muted'}
            />
          </View>
          <Text className='text-xs text-flow-card-header-title'>Built by {item.author}</Text>
        </View>
        {!item.connected && onConnect ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={`Connect ${item.name}`}
            onPress={onConnect}
            className='rounded-full bg-brand px-3 py-1.5'
          >
            <Text className='text-sm font-semibold text-white'>Connect</Text>
          </Pressable>
        ) : null}
      </View>

      {item.description ? (
        <Text className='text-sm leading-5 text-foreground'>{item.description}</Text>
      ) : null}

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text className='text-sm font-semibold text-foreground'>Connection</Text>
          <CircleHelp size={13} color={iconColor} />
        </View>
        <View className='overflow-hidden rounded-xl border border-border bg-card'>
          <View className='flex-row items-center justify-between gap-3 border-b border-border px-3 py-3'>
            <View className='flex-row items-center gap-2'>
              <Link2 size={14} color={iconColor} />
              <Text className='text-sm text-flow-card-header-title'>Endpoint</Text>
            </View>
            <Text className='shrink text-sm text-foreground' numberOfLines={1}>
              {item.url || '—'}
            </Text>
          </View>
          <View className='flex-row items-center justify-between gap-3 px-3 py-3'>
            <View className='flex-row items-center gap-2'>
              <Plug size={14} color={iconColor} />
              <Text className='text-sm text-flow-card-header-title'>Transport</Text>
            </View>
            <Text className='text-sm text-foreground'>{item.transport}</Text>
          </View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text className='text-sm font-semibold text-foreground'>Tools</Text>
            <CircleHelp size={13} color={iconColor} />
          </View>
          {canEdit && item.tools.length > 0 ? (
            <Pressable accessibilityRole='button' onPress={() => onToggleAll(!allSelected)}>
              <Text className='text-xs text-flow-card-header-title'>
                {allSelected ? 'Deselect all' : 'Select all'} ({selectedCount}/{item.tools.length})
              </Text>
            </Pressable>
          ) : (
            <Text className='text-xs text-flow-card-header-title'>
              {selectedCount}/{item.tools.length || item.toolIds.length}
            </Text>
          )}
        </View>

        {item.tools.length === 0 ? (
          <Text className='text-sm text-flow-card-header-title'>No tools listed</Text>
        ) : (
          <View className='overflow-hidden rounded-xl border border-border bg-card'>
            {item.tools.map((tool, index) => {
              const checked = selectedSet.has(tool.id);
              return (
                <Pressable
                  key={tool.id}
                  accessibilityRole='checkbox'
                  accessibilityState={{ checked }}
                  disabled={!canEdit}
                  onPress={() => onToggleTool(tool.id)}
                  className={index === item.tools.length - 1 ? '' : 'border-b border-border'}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <View
                    className={
                      checked
                        ? 'mt-0.5 size-4 items-center justify-center rounded border border-brand bg-brand'
                        : 'mt-0.5 size-4 rounded border border-foreground/30'
                    }
                  >
                    {checked ? <Check size={10} color='#FFFFFF' strokeWidth={3} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text className='text-sm font-semibold text-foreground'>{tool.name}</Text>
                    {tool.description ? (
                      <Text className='text-xs text-flow-card-header-title' numberOfLines={2}>
                        {tool.description}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
};
