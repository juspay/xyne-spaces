import { useState, type ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChevronRight, CircleHelp, Plus, SlidersHorizontal, User } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { SubagentDef, SubagentSource } from '@/src/services/claw/clawSubagentsTypes';
import type { Integration } from '@/src/services/claw/clawToolsTypes';
import {
  SUBAGENT_RISK_LABEL,
  integrationLabelForServerType,
  riskForSubagent,
  type SubagentRiskLevel,
} from '@/src/utils/subagentRisk';

export type SubagentListEntry = {
  id: string;
  name: string;
  description: string;
  ids: string[];
  serverType?: string | undefined;
  source?: SubagentSource | undefined;
};

export type SubagentBrowseFilter = 'all' | 'builtin' | 'custom';

const FILTER_OPTIONS: Array<{ id: SubagentBrowseFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'custom', label: 'Custom' },
];

const RISK_PILL: Record<SubagentRiskLevel, { bg: string; fg: string }> = {
  read: { bg: 'rgba(16, 185, 129, 0.16)', fg: '#34D399' },
  write: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#FBBF24' },
  destructive: { bg: 'rgba(239, 68, 68, 0.16)', fg: '#F87171' },
};

const RiskTag = ({ risk }: { risk: SubagentRiskLevel }): ReactElement => {
  const pill = RISK_PILL[risk];
  return (
    <View className='rounded-full px-1.5 py-0.5' style={{ backgroundColor: pill.bg }}>
      <Text className='text-[11px] font-medium' style={{ color: pill.fg }}>
        {SUBAGENT_RISK_LABEL[risk]}
      </Text>
    </View>
  );
};

const SectionHeading = ({
  label,
  iconColor,
}: {
  label: string;
  iconColor: string;
}): ReactElement => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Text className='text-sm font-semibold text-foreground'>{label}</Text>
    <CircleHelp size={13} color={iconColor} />
  </View>
);

const NamedChips = ({ names, empty }: { names: string[]; empty: string }): ReactElement => {
  if (names.length === 0) {
    return <Text className='text-sm text-flow-card-header-title'>{empty}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {names.map(name => (
        <View key={name} className='rounded-full bg-muted px-2.5 py-1'>
          <Text className='text-sm text-foreground'>{name}</Text>
        </View>
      ))}
    </View>
  );
};

export const SubagentBrowseRow = ({
  item,
  integrations,
  highlighted = false,
  onPress,
}: {
  item: SubagentListEntry;
  integrations?: Integration[];
  highlighted?: boolean;
  onPress: () => void;
}): ReactElement => {
  const chevron = useCSSVariable('--color-foreground') as string;
  const risk = riskForSubagent(item.serverType, integrations);
  const isCustom = item.source === 'custom';

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
        backgroundColor: highlighted ? 'rgba(148, 163, 184, 0.12)' : undefined,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Text className='shrink text-sm font-semibold text-foreground' numberOfLines={1}>
            {item.name}
          </Text>
          <RiskTag risk={risk} />
        </View>
        {item.description ? (
          <Text className='text-xs text-flow-card-header-title' numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
      {isCustom ? <Plus size={14} color={chevron} /> : null}
      <ChevronRight size={16} color={chevron} />
    </Pressable>
  );
};

export const SubagentBrowseToolbar = ({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: SubagentBrowseFilter;
  onFilterChange: (value: SubagentBrowseFilter) => void;
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
          accessibilityLabel='Filter subagents'
          onPress={() => setOpen(current => !current)}
          className='size-10 items-center justify-center rounded-xl border border-border bg-card'
        >
          <SlidersHorizontal size={16} color={icon} />
        </Pressable>
      </View>
      {open ? (
        <View className='absolute right-0 top-12 z-10 overflow-hidden rounded-xl border border-border bg-card'>
          {FILTER_OPTIONS.map(option => {
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

export const SubagentBrowseGrid = ({
  items,
  integrations,
  isHighlighted,
  onOpen,
}: {
  items: SubagentListEntry[];
  integrations?: Integration[];
  isHighlighted?: (item: SubagentListEntry) => boolean;
  onOpen: (item: SubagentListEntry) => void;
}): ReactElement => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
    {items.map(item => (
      <View key={item.id} style={{ width: '50%', paddingHorizontal: 4, paddingVertical: 4 }}>
        <SubagentBrowseRow
          item={item}
          {...(integrations ? { integrations } : {})}
          highlighted={isHighlighted?.(item) ?? false}
          onPress={() => onOpen(item)}
        />
      </View>
    ))}
  </View>
);

export const SubagentDetailView = ({
  item,
  detail,
  integrations,
  canAdd,
  isAdded,
  onAdd,
}: {
  item: SubagentListEntry;
  detail?: SubagentDef;
  integrations?: Integration[];
  canAdd: boolean;
  isAdded: boolean;
  onAdd?: () => void;
}): ReactElement => {
  const iconColor = useCSSVariable('--color-foreground') as string;
  const description = detail?.description?.trim() || item.description;
  const instructions = detail?.systemPrompt?.trim() ?? '';
  const paramName = detail?.paramName?.trim() || 'question';
  const paramDescription = detail?.paramDescription?.trim() ?? '';
  const mcpLabel = integrationLabelForServerType(
    detail?.serverType ?? item.serverType,
    integrations,
  );
  const builtinTools = detail?.tools?.custom ?? [];
  const systemTools = detail?.tools?.direct ?? [];
  const skills = (detail?.skills ?? []).map(skill => skill.name || skill.slug);
  const contributors = (detail?.shares ?? []).map(
    share => share.name?.trim() || share.email?.trim() || share.userId,
  );

  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View className='size-10 items-center justify-center rounded-full bg-muted'>
          <User size={18} color={iconColor} />
        </View>
        <Text className='flex-1 text-base font-semibold text-foreground'>{item.name}</Text>
        {canAdd ? (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={isAdded ? 'Added' : `Add ${item.name}`}
            disabled={isAdded}
            onPress={onAdd}
            className={
              isAdded ? 'rounded-full bg-muted px-3 py-1.5' : 'rounded-full bg-brand px-3 py-1.5'
            }
          >
            <Text
              className={
                isAdded
                  ? 'text-sm font-semibold text-foreground'
                  : 'text-sm font-semibold text-white'
              }
            >
              {isAdded ? 'Added' : 'Add'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {description ? (
        <Text className='text-sm leading-5 text-foreground'>{description}</Text>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeading label='Instructions' iconColor={iconColor} />
        <View className='rounded-xl border border-border bg-card px-3 py-3'>
          {instructions ? (
            <Text className='text-sm leading-5 text-foreground'>{instructions}</Text>
          ) : (
            <Text className='text-sm text-flow-card-header-title'>No instructions added</Text>
          )}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='Contributors' iconColor={iconColor} />
        <NamedChips names={contributors} empty='No contributors added' />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='Parameter' iconColor={iconColor} />
        <View style={{ gap: 10 }}>
          <View style={{ gap: 2 }}>
            <Text className='text-sm font-semibold text-foreground'>Name</Text>
            <Text className='text-sm text-foreground'>{paramName}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text className='text-sm font-semibold text-foreground'>Description</Text>
            <Text className='text-sm text-foreground'>
              {paramDescription || 'No parameter description'}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='MCP' iconColor={iconColor} />
        <NamedChips names={mcpLabel ? [mcpLabel] : []} empty='No MCP added' />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='Built-in Tools' iconColor={iconColor} />
        <NamedChips names={builtinTools} empty='No built-in tools added' />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='System Tools' iconColor={iconColor} />
        <NamedChips names={systemTools} empty='No system tools added' />
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeading label='Skills' iconColor={iconColor} />
        <NamedChips names={skills} empty='No skills added' />
      </View>
    </View>
  );
};
