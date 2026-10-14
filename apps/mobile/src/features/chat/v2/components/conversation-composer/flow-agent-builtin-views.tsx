import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  Check,
  ChevronRight,
  CircleHelp,
  LayoutGrid,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  BUILTIN_FILTER_OPTIONS,
  builtinCountLabel,
  builtinInitials,
  builtinMainSubtitle,
  builtinToolCountLabel,
  type BuiltinBrowseFilter,
  type BuiltinBrowseItem,
} from '@/src/utils/builtinBrowse';
import { SUBAGENT_RISK_LABEL } from '@/src/utils/subagentRisk';

const ENABLED_BG = 'rgba(16, 185, 129, 0.16)';

const StatusTag = ({
  enabled,
  risk,
}: {
  enabled: boolean;
  risk: BuiltinBrowseItem['risk'];
}): ReactElement => {
  const fg = enabled || risk === 'read' ? '#34D399' : risk === 'write' ? '#FBBF24' : '#F87171';
  const bg =
    enabled || risk === 'read'
      ? 'rgba(16, 185, 129, 0.16)'
      : risk === 'write'
        ? 'rgba(245, 158, 11, 0.16)'
        : 'rgba(239, 68, 68, 0.16)';
  return (
    <View className='rounded-full px-1.5 py-0.5' style={{ backgroundColor: bg }}>
      <Text className='text-[11px] font-medium' style={{ color: fg }}>
        {enabled ? 'Enabled' : SUBAGENT_RISK_LABEL[risk]}
      </Text>
    </View>
  );
};

export const BuiltinBrowseToolbar = ({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: BuiltinBrowseFilter;
  onFilterChange: (value: BuiltinBrowseFilter) => void;
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
          accessibilityLabel='Filter built-in tools'
          onPress={() => setOpen(current => !current)}
          className='size-10 items-center justify-center rounded-xl border border-border bg-card'
        >
          <SlidersHorizontal size={16} color={icon} />
        </Pressable>
      </View>
      {open ? (
        <View className='absolute right-0 top-12 z-10 overflow-hidden rounded-xl border border-border bg-card'>
          {BUILTIN_FILTER_OPTIONS.map(option => {
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

export const BuiltinSelectedChips = ({
  items,
  onRemove,
}: {
  items: Array<{ id: string; name: string }>;
  onRemove: (id: string) => void;
}): ReactElement | null => {
  const icon = useCSSVariable('--color-foreground') as string;
  if (items.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(item => (
        <Pressable
          key={item.id}
          accessibilityRole='button'
          accessibilityLabel={`Remove ${item.name}`}
          onPress={() => onRemove(item.id)}
          className='flex-row items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1'
        >
          <Text className='text-xs text-foreground'>{item.name}</Text>
          <X size={11} color={icon} />
        </Pressable>
      ))}
    </View>
  );
};

export const BuiltinMainRow = ({
  item,
  selectedIds,
  canEdit,
  onPress,
  onRemove,
}: {
  item: BuiltinBrowseItem;
  selectedIds: string[];
  canEdit: boolean;
  onPress: () => void;
  onRemove?: () => void;
}): ReactElement => {
  const icon = useCSSVariable('--color-foreground') as string;
  const count = selectedIds.length > 0 ? selectedIds.length : item.tools.length;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
      }}
    >
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={item.name}
        onPress={onPress}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <View className='size-8 items-center justify-center rounded-full bg-muted'>
          <Text className='text-[11px] font-semibold text-foreground'>
            {builtinInitials(item.name)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text className='text-sm font-semibold text-foreground' numberOfLines={1}>
            {item.name}
          </Text>
          <Text className='text-sm text-flow-card-header-title' numberOfLines={1}>
            {builtinMainSubtitle(item, selectedIds)}
          </Text>
        </View>
      </Pressable>
      <Text className='text-xs text-flow-card-header-title'>{builtinToolCountLabel(count)}</Text>
      {canEdit && onRemove ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Remove ${item.name}`}
          hitSlop={8}
          onPress={onRemove}
        >
          <X size={16} color={icon} />
        </Pressable>
      ) : null}
    </View>
  );
};

export const BuiltinBrowseRow = ({
  item,
  selectedCount,
  onPress,
}: {
  item: BuiltinBrowseItem;
  selectedCount: number;
  onPress: () => void;
}): ReactElement => {
  const chevron = useCSSVariable('--color-foreground') as string;
  const enabled = selectedCount > 0;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={item.name}
      onPress={onPress}
      className='rounded-xl'
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 12,
        gap: 8,
        backgroundColor: enabled ? ENABLED_BG : undefined,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text className='shrink text-sm font-semibold text-foreground' numberOfLines={1}>
            {item.name}
          </Text>
          <StatusTag enabled={enabled} risk={item.risk} />
        </View>
        <Text className='text-xs text-flow-card-header-title' numberOfLines={1}>
          {builtinCountLabel(selectedCount, item.tools.length)}
        </Text>
      </View>
      <ChevronRight size={16} color={chevron} />
    </Pressable>
  );
};

export const BuiltinBrowseGrid = ({
  items,
  selectedCountFor,
  onOpen,
}: {
  items: BuiltinBrowseItem[];
  selectedCountFor: (item: BuiltinBrowseItem) => number;
  onOpen: (item: BuiltinBrowseItem) => void;
}): ReactElement => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
    {items.map(item => (
      <View key={item.id} style={{ width: '50%', paddingHorizontal: 4, paddingVertical: 4 }}>
        <BuiltinBrowseRow
          item={item}
          selectedCount={selectedCountFor(item)}
          onPress={() => onOpen(item)}
        />
      </View>
    ))}
  </View>
);

export const BuiltinDetailView = ({
  item,
  selectedIds,
  canEdit,
  onToggleTool,
  onToggleAll,
  onEnable,
  onDisable,
}: {
  item: BuiltinBrowseItem;
  selectedIds: string[];
  canEdit: boolean;
  onToggleTool: (id: string) => void;
  onToggleAll: (selectAll: boolean) => void;
  onEnable: () => void;
  onDisable: () => void;
}): ReactElement => {
  const iconColor = useCSSVariable('--color-foreground') as string;
  const selectedSet = new Set(selectedIds);
  const selectedCount = item.tools.filter(tool => selectedSet.has(tool.id)).length;
  const allSelected = item.tools.length > 0 && selectedCount === item.tools.length;
  const enabled = selectedCount > 0;

  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View className='size-10 items-center justify-center rounded-full bg-muted'>
          <LayoutGrid size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text className='text-base font-semibold text-foreground'>{item.name}</Text>
            <StatusTag enabled={false} risk={item.risk} />
          </View>
          <Text className='text-xs text-flow-card-header-title'>
            {item.tools.length === 1 ? '1 tool available' : `${item.tools.length} tools available`}
          </Text>
        </View>
        {canEdit ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={enabled ? `Disable ${item.name}` : `Enable ${item.name}`}
            onPress={enabled ? onDisable : onEnable}
            className={
              enabled
                ? 'rounded-full border border-border bg-card px-3 py-1.5'
                : 'rounded-full bg-brand px-3 py-1.5'
            }
          >
            <Text
              className={
                enabled
                  ? 'text-sm font-semibold text-foreground'
                  : 'text-sm font-semibold text-white'
              }
            >
              {enabled ? 'Disable' : 'Enable'}
            </Text>
          </Pressable>
        ) : null}
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
                {allSelected ? 'Clear all' : `Select all (${selectedCount}/${item.tools.length})`}
              </Text>
            </Pressable>
          ) : (
            <Text className='text-xs text-flow-card-header-title'>
              {selectedCount}/{item.tools.length}
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
                        ? 'mt-0.5 size-4 items-center justify-center rounded-full border border-brand bg-brand'
                        : 'mt-0.5 size-4 rounded-full border border-foreground/30'
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
