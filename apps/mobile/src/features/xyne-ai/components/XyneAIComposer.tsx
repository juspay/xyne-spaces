import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import {
  ArrowUp,
  AtSign,
  Bot,
  Globe,
  Plus,
  Square,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  COMPOSER_SEND_BUTTON_SIZE,
  composerSendOpacity,
} from '@/src/components/input-composer/composer-input-typography';
import { ListRow, ListRowDivider, SectionCard } from '@/src/components/ui/settings-list';
import { Switch } from '@/src/components/ui/switch';
import { haptics } from '@/src/utils/haptics';

import type { AttachedContextItem } from '../api/xyneAIRequest';
import type { ModeState, XyneAISelection } from '../hooks/useXyneAISelection';
import { pickPlaceholder } from '../model/greeting';
import { modelPillLabel } from '../model/modelSelection';
import { AgentDot } from './AgentDot';
import { AgentSheet } from './AgentSheet';
import { ContextPickerSheet } from './ContextPickerSheet';
import { ModelSheet } from './ModelSheet';
import { PickerSheet } from './PickerSheet';

const INPUT_FONT_SIZE = 15;
const INPUT_LINE_HEIGHT = 24;
const INPUT_MAX_HEIGHT = 220;

const Chip = ({
  label,
  className = 'border-conversation-input-pill-border bg-conversation-input-pill-bg',
  textClassName = 'text-conversation-input-text',
  iconColor,
  leading,
  onPress,
}: {
  label: string;
  className?: string;
  textClassName?: string;
  iconColor: string;
  leading?: ReactNode;
  onPress: () => void;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={`Remove ${label}`}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    className={`h-7 max-w-full flex-row items-center gap-1.5 rounded-full border px-2.5 active:opacity-60 ${className}`}
  >
    {leading}
    <Text numberOfLines={1} className={`shrink text-[13px] ${textClassName}`}>
      {label}
    </Text>
    <X size={12} color={iconColor} />
  </Pressable>
);

const ModeChip = ({
  icon,
  label,
  mode,
}: {
  icon: LucideIcon;
  label: string;
  mode: ModeState;
}): ReactElement | null => {
  const Icon = icon;
  const blue = useCSSVariable('--color-settings-icon-blue') as string;
  return mode.enabled ? (
    <Chip
      label={label}
      className='border-settings-icon-blue/30 bg-settings-icon-blue/10'
      textClassName='text-settings-icon-blue'
      iconColor={blue}
      leading={<Icon size={13} color={blue} />}
      onPress={mode.toggle}
    />
  ) : null;
};

const ComposerChips = ({
  selection,
  onSelectAgent,
}: {
  selection: XyneAISelection;
  onSelectAgent: (slug: string | undefined) => void;
}): ReactElement => {
  const muted = useCSSVariable('--color-conversation-input-toolbar-icon') as string;
  const { agent, modes } = selection;

  return (
    <View className='min-w-0 flex-1 flex-row flex-wrap gap-1.5'>
      {agent ? (
        <Chip
          label={agent.name}
          iconColor={muted}
          leading={<AgentDot color={agent.color} />}
          onPress={(): void => onSelectAgent(undefined)}
        />
      ) : null}
      <ModeChip icon={Globe} label='Web search' mode={modes.webSearch} />
      <ModeChip icon={Target} label='Deep search' mode={modes.deepResearch} />
    </View>
  );
};

const SendButton = ({
  isStreaming,
  canSend,
  onPress,
}: {
  isStreaming: boolean;
  canSend: boolean;
  onPress: () => void;
}): ReactElement => {
  const iconColor = useCSSVariable('--color-conversation-input-send-icon') as string;
  const isEnabled = isStreaming || canSend;
  const Icon = isStreaming ? Square : ArrowUp;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={isStreaming ? 'Stop' : 'Send'}
      disabled={!isEnabled}
      onPress={onPress}
      className='items-center justify-center rounded-full bg-brand'
      style={{
        width: COMPOSER_SEND_BUTTON_SIZE,
        height: COMPOSER_SEND_BUTTON_SIZE,
        opacity: composerSendOpacity(isEnabled),
      }}
    >
      <Icon
        size={isStreaming ? 14 : 20}
        color={iconColor}
        fill={isStreaming ? iconColor : 'none'}
      />
    </Pressable>
  );
};

const ModeRow = ({
  icon,
  label,
  mode,
}: {
  icon: LucideIcon;
  label: string;
  mode: ModeState;
}): ReactElement => (
  <ListRow
    icon={icon}
    label={label}
    trailing={
      <Switch isSelected={mode.enabled} onSelectedChange={mode.toggle} accessibilityLabel={label} />
    }
  />
);

const PlusSheet = ({
  isOpen,
  onOpenChange,
  selection,
  onOpenAgents,
  onOpenContext,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selection: XyneAISelection;
  onOpenAgents: () => void;
  onOpenContext: () => void;
}): ReactElement => {
  const { webSearch, deepResearch } = selection.modes;

  return (
    <PickerSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <SectionCard>
        {webSearch.accessible ? <ModeRow icon={Globe} label='Web search' mode={webSearch} /> : null}
        {webSearch.accessible && deepResearch.accessible ? <ListRowDivider /> : null}
        {deepResearch.accessible ? (
          <ModeRow icon={Target} label='Deep search' mode={deepResearch} />
        ) : null}
        {webSearch.accessible || deepResearch.accessible ? <ListRowDivider inset={0} /> : null}
        <ListRow
          icon={Bot}
          label='Agent'
          value={selection.agent?.name ?? 'Ask AI'}
          showChevron
          onPress={onOpenAgents}
        />
        <ListRowDivider inset={0} />
        <ListRow icon={AtSign} label='Add context' showChevron onPress={onOpenContext} />
      </SectionCard>
    </PickerSheet>
  );
};

type Sheet = 'plus' | 'agent' | 'model' | 'context';

export const XyneAIComposer = ({
  value,
  onChangeText,
  isStreaming,
  onSubmit,
  onStop,
  selection,
  onSelectAgent,
  context,
  onContextChange,
}: {
  value: string;
  onChangeText: (text: string) => void;
  isStreaming: boolean;
  onSubmit: () => void;
  onStop: () => void;
  selection: XyneAISelection;
  onSelectAgent: (slug: string | undefined) => void;
  context: AttachedContextItem[];
  onContextChange: (context: AttachedContextItem[]) => void;
}): ReactElement => {
  const [sheet, setSheet] = useState<Sheet>();
  const placeholder = useRef(pickPlaceholder()).current;
  const textColor = useCSSVariable('--color-conversation-input-text') as string;
  const placeholderColor = useCSSVariable('--color-conversation-input-placeholder') as string;
  const iconColor = useCSSVariable('--color-conversation-input-toolbar-icon') as string;
  const selectedModel = selection.models.find(({ id }) => id === selection.model);
  const openSheet = (name: Sheet): void => {
    Keyboard.dismiss();
    setSheet(name);
  };
  const bindSheet = (name: Sheet): { isOpen: boolean; onOpenChange: (open: boolean) => void } => ({
    isOpen: sheet === name,
    onOpenChange: (open): void => setSheet(open ? name : undefined),
  });

  // A fresh "@" opens the context picker instead of being typed.
  const handleChangeText = (text: string): void => {
    const typedAt = text.length === value.length + 1 && text.endsWith('@') && /(^|\s)$/.test(value);
    if (typedAt) openSheet('context');
    else onChangeText(text);
  };

  return (
    <View className='overflow-hidden rounded-[20px] border border-border bg-conversation-input-bg'>
      {context.length > 0 ? (
        <View className='flex-row flex-wrap gap-1.5 px-3 pt-3'>
          {context.map(item => (
            <Chip
              key={`${item.type}:${item.id}`}
              label={item.title}
              iconColor={iconColor}
              onPress={(): void => onContextChange(context.filter(other => other !== item))}
            />
          ))}
        </View>
      ) : null}
      <TextInput
        multiline
        value={value}
        onChangeText={handleChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        className='px-4 pb-1 pt-3.5'
        style={{
          color: textColor,
          fontSize: INPUT_FONT_SIZE,
          lineHeight: INPUT_LINE_HEIGHT,
          maxHeight: INPUT_MAX_HEIGHT,
        }}
      />
      <View className='flex-row items-end gap-1.5 px-2 pb-2'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Add to message'
          onPress={(): void => {
            void haptics.buttonTap();
            openSheet('plus');
          }}
          className='size-8 items-center justify-center rounded-full active:opacity-60'
        >
          <Plus size={20} color={iconColor} />
        </Pressable>
        <ComposerChips selection={selection} onSelectAgent={onSelectAgent} />
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Choose model'
          onPress={(): void => {
            void haptics.buttonTap();
            openSheet('model');
          }}
          className='h-8 shrink-0 justify-center rounded-full px-2 active:opacity-60'
        >
          <Text className='text-[14px] text-conversation-input-text'>
            {modelPillLabel(selectedModel)}
          </Text>
        </Pressable>
        <SendButton
          isStreaming={isStreaming}
          canSend={value.trim() !== ''}
          onPress={(): void => {
            void haptics.buttonTap();
            if (isStreaming) onStop();
            else onSubmit();
          }}
        />
      </View>
      <PlusSheet
        {...bindSheet('plus')}
        selection={selection}
        onOpenAgents={(): void => openSheet('agent')}
        onOpenContext={(): void => openSheet('context')}
      />
      <ContextPickerSheet
        isOpen={sheet === 'context'}
        onClose={(): void => setSheet(undefined)}
        selected={context}
        onApply={onContextChange}
      />
      <AgentSheet
        {...bindSheet('agent')}
        agents={selection.agents}
        selected={selection.agentSlug}
        onSelect={(slug): void => {
          setSheet(undefined);
          onSelectAgent(slug);
        }}
      />
      <ModelSheet
        {...bindSheet('model')}
        models={selection.models}
        model={selection.model}
        defaultModelName={selection.defaultModelName}
        thinkingLevel={selection.thinkingLevel}
        onSelectModel={(model): void => {
          setSheet(undefined);
          selection.selectModel(model);
        }}
        onSelectThinkingLevel={(level): void => {
          setSheet(undefined);
          selection.selectThinkingLevel(level);
        }}
      />
    </View>
  );
};
