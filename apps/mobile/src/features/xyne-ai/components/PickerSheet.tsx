import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, ChevronLeft, X } from 'lucide-react-native';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { SearchBar } from '@/src/components/ui/search-bar';
import {
  ListRow,
  ListRowDivider,
  SectionFootnote,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import type { XyneAIAgent, XyneAIModel } from '../api/xyneAICatalog';
import type { ThinkingLevel } from '../api/xyneAIRequest';
import { commandSections } from '../model/composerInputs';
import { THINKING_OPTIONS, autoModelDescription, modelLabel } from '../model/modelSelection';
import { AgentDot } from './AgentDot';

// On Android AppBottomSheet already sits above the navigation bar.
export const useSheetBottomPadding = (): number => {
  const { bottom } = useSafeAreaInsets();
  return (Platform.OS === 'ios' ? bottom : 0) + 16;
};

const SheetHeader = ({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack: (() => void) | undefined;
  onClose: () => void;
}): ReactElement => {
  const iconColor = useCSSVariable('--color-foreground') as string;
  const Icon = onBack ? ChevronLeft : X;
  return (
    <View className='h-14 flex-row items-center justify-between px-4'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={onBack ? 'Back' : 'Close'}
        onPress={(): void => {
          void haptics.buttonTap();
          (onBack ?? onClose)();
        }}
        className='size-9 items-center justify-center rounded-full bg-secondary active:opacity-60'
      >
        <Icon size={20} color={iconColor} />
      </Pressable>
      <Text accessibilityRole='header' className='text-[17px] font-semibold text-foreground'>
        {title}
      </Text>
      <View className='size-9' />
    </View>
  );
};

/** A grouped card that stands out from the sheet behind it, in light and dark. */
export const SheetCard = ({ children }: { children: ReactNode }): ReactElement => (
  <View className='overflow-hidden rounded-2xl bg-bottomsheet-container-bg'>{children}</View>
);

/**
 * Holds an action until the sheet has fully closed. A picker, share sheet or alert opened while it is
 * still animating away is presented under it on iOS, so the sheet looks stuck open.
 */
export function useAfterDismiss(): {
  afterDismiss: (action: () => void) => void;
  onDismiss: () => void;
} {
  const pending = useRef<(() => void) | undefined>(undefined);
  const afterDismiss = useCallback((action: () => void): void => {
    pending.current = action;
  }, []);
  const onDismiss = useCallback((): void => {
    const action = pending.current;
    pending.current = undefined;
    action?.();
  }, []);
  return { afterDismiss, onDismiss };
}

export const PickerSheet = ({
  isOpen,
  onOpenChange,
  title,
  onBack,
  onDismiss,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onDismiss?: () => void;
  /** On a sub-page: replaces the close button with a back button. */
  onBack?: () => void;
  children: ReactNode;
}): ReactElement => {
  const paddingBottom = useSheetBottomPadding();
  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      {...(onDismiss && { onDismiss })}
      mode='dynamic'
    >
      <SheetHeader title={title} onBack={onBack} onClose={(): void => onOpenChange(false)} />
      <BottomSheetScrollView
        contentContainerStyle={{ gap: 12, padding: 16, paddingTop: 4, paddingBottom }}
      >
        {children}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
};

const SEARCH_MIN_OPTIONS = 7;
const PLAIN_ROW_DIVIDER_INSET = 16;

interface Option<T extends string> {
  /** `undefined` is the "use the default" choice. */
  value: T | undefined;
  label: string;
  description?: string;
  leading?: ReactElement;
}

function OptionList<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: Option<T>[];
  selected: T | undefined;
  onSelect: (value: T | undefined) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const { accentText } = useBubbleAccent();
  const needle = query.trim().toLowerCase();
  const visible = options.filter(option => option.label.toLowerCase().includes(needle));

  return (
    <View>
      {options.length > SEARCH_MIN_OPTIONS ? (
        <SearchBar value={query} onChangeText={setQuery} containerClassName='mb-3' />
      ) : null}
      <SheetCard>
        {visible.map((option, index) => (
          <View key={option.value ?? 'default'}>
            {index > 0 ? (
              <ListRowDivider {...(option.leading ? {} : { inset: PLAIN_ROW_DIVIDER_INSET })} />
            ) : null}
            <ListRow
              label={option.label}
              description={option.description}
              leading={option.leading}
              trailing={
                option.value === selected ? <Check size={20} color={accentText} /> : undefined
              }
              onPress={(): void => onSelect(option.value)}
            />
          </View>
        ))}
      </SheetCard>
    </View>
  );
}

export const AgentSheet = ({
  isOpen,
  onOpenChange,
  agents,
  selected,
  onSelect,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  agents: XyneAIAgent[];
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
}): ReactElement => {
  const options: Option<string>[] = [
    { value: undefined, label: 'Ask AI', leading: <AgentDot color={undefined} /> },
    ...agents.map(agent => ({
      value: agent.slug,
      label: agent.name,
      leading: <AgentDot color={agent.color} />,
    })),
  ];

  return (
    <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange} title='Agent'>
      <OptionList options={options} selected={selected} onSelect={onSelect} />
    </PickerSheet>
  );
};

export const ModelSheet = ({
  isOpen,
  onOpenChange,
  models,
  model,
  defaultModelName,
  thinkingLevel,
  onSelectModel,
  onSelectThinkingLevel,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: XyneAIModel[];
  model: string | undefined;
  defaultModelName: string | undefined;
  thinkingLevel: ThinkingLevel | undefined;
  onSelectModel: (model: string | undefined) => void;
  onSelectThinkingLevel: (level: ThinkingLevel | undefined) => void;
}): ReactElement => {
  const [page, setPage] = useState<'models' | 'thinking'>('models');
  useEffect(() => {
    if (isOpen) setPage('models');
  }, [isOpen]);
  const modelOptions: Option<string>[] = [
    { value: undefined, label: 'Auto', description: autoModelDescription(defaultModelName) },
    ...models.map(candidate => ({
      value: candidate.id,
      label: modelLabel(candidate),
      ...(candidate.description && { description: candidate.description }),
    })),
  ];

  return page === 'models' ? (
    <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange} title='Select model'>
      <OptionList options={modelOptions} selected={model} onSelect={onSelectModel} />
      <SheetCard>
        <ListRow
          label='Thinking'
          value={THINKING_OPTIONS.find(({ value }) => value === thinkingLevel)?.label}
          showChevron
          onPress={(): void => setPage('thinking')}
        />
      </SheetCard>
    </PickerSheet>
  ) : (
    <PickerSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title='Thinking'
      onBack={(): void => setPage('models')}
    >
      <View>
        <OptionList
          options={THINKING_OPTIONS}
          selected={thinkingLevel}
          onSelect={onSelectThinkingLevel}
        />
        <SectionFootnote>
          Higher thinking means more thorough answers, but takes longer.
        </SectionFootnote>
      </View>
    </PickerSheet>
  );
};

export const SlashCommandSheet = ({
  isOpen,
  onOpenChange,
  onSelect,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (name: string) => void;
}): ReactElement => (
  <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange} title='Slash commands'>
    {commandSections.map(({ title, commands }) => (
      <View key={title}>
        <SectionLabel>{title}</SectionLabel>
        <SheetCard>
          {commands.map(({ name, label, help }, index) => (
            <View key={name}>
              {index > 0 ? <ListRowDivider inset={16} /> : null}
              <ListRow label={label} description={help} onPress={(): void => onSelect(name)} />
            </View>
          ))}
        </SheetCard>
      </View>
    ))}
  </PickerSheet>
);
