import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowUp,
  AtSign,
  BookOpen,
  Bot,
  Camera,
  Check,
  FileText,
  Globe,
  Hash,
  ImageIcon,
  MessageCircleMore,
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Square,
  SquareSlash,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useCSSVariable, useUniwind } from 'uniwind';

import {
  COMPOSER_SEND_BUTTON_SIZE,
  composerSendOpacity,
} from '@/src/components/input-composer/composer-input-typography';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import type {
  MentionChannelOption,
  MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';
import { MAX_COMPOSER_ATTACHMENT_COUNT } from '@/src/components/input-composer/utils/attachmentPolicy';
import {
  pickFromCamera,
  pickFromFiles,
  pickFromGallery,
  type AttachmentPicker,
} from '@/src/components/input-composer/utils/composer-attachments-picker';
import Avatar from '@/src/components/ui/avatar';
import { GlassSurface } from '@/src/components/ui/glass-surface';
import { ListRow, ListRowDivider } from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import type { AttachedContextItem, AttachedFile } from '../api/xyneAIRequest';
import type { ModeState, XyneAISelection } from '../hooks/useXyneAISelection';
import { MAX_FILES, fileLimitError, withCommand } from '../model/composerInputs';
import {
  channelPick,
  isCollectionPick,
  oneLine,
  personPick,
  pickKey,
  togglePick,
} from '../model/contextPicks';
import { useDictation } from '../hooks/useDictation';
import { activeMention, insertMention } from '../model/mentionTrigger';
import { THINKING_OPTIONS, modelPillLabel } from '../model/modelSelection';
import { AgentDot } from './AgentDot';
import { CollectionsSheet } from './CollectionsSheet';
import { ContextPickerSheet, ICONS } from './ContextPickerSheet';
import { DictationWaveform } from './DictationWaveform';
import { MentionSuggestions } from './MentionSuggestions';
import {
  AgentSheet,
  ModelSheet,
  PickerSheet,
  SheetCard,
  SlashCommandSheet,
  useAfterDismiss,
} from './PickerSheet';

const INPUT_FONT_SIZE = 15;
const INPUT_LINE_HEIGHT = 24;
const INPUT_MAX_HEIGHT = 220;
const COMPOSER_RADIUS = 24;
const TOOLBAR_BUTTON_SIZE = 36;

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
    className={`h-7 max-w-[200px] flex-row items-center gap-1.5 rounded-full border px-2.5 active:opacity-60 ${className}`}
  >
    {leading}
    <Text numberOfLines={1} className={`shrink text-[13px] ${textClassName}`}>
      {oneLine(label)}
    </Text>
    <X size={12} color={iconColor} />
  </Pressable>
);

// One line that scrolls sideways, so chips never push the input or its buttons around.
const ChipRow = ({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}): ReactElement => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    keyboardShouldPersistTaps='handled'
    className={className}
    contentContainerClassName='items-center gap-1.5'
  >
    {children}
  </ScrollView>
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

const ToolbarButton = ({
  label,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    disabled={disabled}
    onPress={(): void => {
      void haptics.buttonTap();
      onPress();
    }}
    className={`items-center justify-center rounded-full bg-conversation-input-pill-bg active:opacity-60 ${disabled ? 'opacity-40' : ''}`}
    style={{ width: TOOLBAR_BUTTON_SIZE, height: TOOLBAR_BUTTON_SIZE }}
  >
    {children}
  </Pressable>
);

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

const ModelPill = ({
  selection,
  onPress,
}: {
  selection: XyneAISelection;
  onPress: () => void;
}): ReactElement => {
  const name = modelPillLabel(selection.models.find(({ id }) => id === selection.model));
  const thinking = selection.thinkingLevel
    ? THINKING_OPTIONS.find(({ value }) => value === selection.thinkingLevel)?.label
    : undefined;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Model, ${name}`}
      accessibilityHint='Choose the model for this chat'
      onPress={(): void => {
        void haptics.buttonTap();
        onPress();
      }}
      className='min-w-0 shrink flex-row items-center rounded-full bg-conversation-input-pill-bg px-3 active:opacity-60'
      style={{ height: TOOLBAR_BUTTON_SIZE }}
    >
      <Text numberOfLines={1} className='text-[14px] text-conversation-input-text'>
        {name}
        {thinking ? <Text className='text-secondary-foreground'>{` ${thinking}`}</Text> : null}
      </Text>
    </Pressable>
  );
};

const AttachTile = ({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}): ReactElement => {
  const Icon = icon;
  const color = useCSSVariable('--color-foreground') as string;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={(): void => {
        void haptics.buttonTap();
        onPress();
      }}
      className='flex-1 items-center gap-2 rounded-2xl bg-bottomsheet-container-bg py-4 active:opacity-60'
    >
      <Icon size={24} color={color} />
      <Text className='text-[14px] text-foreground'>{label}</Text>
    </Pressable>
  );
};

const ModeRow = ({
  icon,
  label,
  mode,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  mode: ModeState;
  onToggle: () => void;
}): ReactElement => {
  const { accentText } = useBubbleAccent();
  return (
    <ListRow
      icon={icon}
      label={label}
      description={mode.accessible ? undefined : 'Not available'}
      onPress={mode.accessible ? onToggle : undefined}
      trailing={mode.enabled ? <Check size={20} color={accentText} /> : undefined}
    />
  );
};

const PlusSheet = ({
  isOpen,
  onOpenChange,
  selection,
  collectionCount,
  onOpen,
  onAttach,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selection: XyneAISelection;
  collectionCount: number;
  onOpen: (sheet: Sheet) => void;
  onAttach: (picker: AttachmentPicker) => void;
}): ReactElement => {
  const { webSearch, deepResearch } = selection.modes;
  const { afterDismiss, onDismiss } = useAfterDismiss();
  const attach = (picker: AttachmentPicker) => (): void => {
    afterDismiss(() => onAttach(picker));
    onOpenChange(false);
  };
  // Like ChatGPT and Claude: the sheet closes so the mode's tag shows in the composer it covers.
  const toggleAndClose = (mode: ModeState) => (): void => {
    mode.toggle();
    onOpenChange(false);
  };

  return (
    <PickerSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      title='Add to Chat'
    >
      <View className='flex-row gap-3'>
        <AttachTile icon={Camera} label='Camera' onPress={attach(pickFromCamera)} />
        <AttachTile icon={ImageIcon} label='Photos' onPress={attach(pickFromGallery)} />
        <AttachTile icon={FileText} label='Files' onPress={attach(pickFromFiles)} />
      </View>
      <SheetCard>
        <ModeRow
          icon={Globe}
          label='Web search'
          mode={webSearch}
          onToggle={toggleAndClose(webSearch)}
        />
        <ListRowDivider />
        <ModeRow
          icon={Target}
          label='Deep search'
          mode={deepResearch}
          onToggle={toggleAndClose(deepResearch)}
        />
      </SheetCard>
      <SheetCard>
        <ListRow
          icon={BookOpen}
          label='Collections'
          value={collectionCount > 0 ? String(collectionCount) : undefined}
          showChevron
          onPress={(): void => onOpen('collections')}
        />
        <ListRowDivider />
        <ListRow
          icon={Bot}
          label='Agent'
          value={selection.agent?.name ?? 'Ask AI'}
          showChevron
          onPress={(): void => onOpen('agent')}
        />
        <ListRowDivider />
        <ListRow
          icon={SquareSlash}
          label='Slash commands'
          showChevron
          onPress={(): void => onOpen('commands')}
        />
        <ListRowDivider />
        <ListRow
          icon={AtSign}
          label='Add context'
          showChevron
          onPress={(): void => onOpen('context')}
        />
      </SheetCard>
    </PickerSheet>
  );
};

type Sheet = 'plus' | 'agent' | 'model' | 'context' | 'collections' | 'commands';

const toAttachedFile = async ({
  localUri,
  originalFilename,
  mimetype,
}: ComposerAttachment): Promise<AttachedFile> => ({
  filename: originalFilename,
  mimeType: mimetype,
  data: await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 }),
});

interface ComposerSheetsProps {
  sheet: Sheet | undefined;
  setSheet: Dispatch<SetStateAction<Sheet | undefined>>;
  openSheet: (sheet: Sheet) => void;
  selection: XyneAISelection;
  onSelectAgent: (slug: string | undefined) => void;
  context: AttachedContextItem[];
  onContextChange: (context: AttachedContextItem[]) => void;
  onAttach: (picker: AttachmentPicker) => void;
  onCommand: (name: string) => void;
}

// Memoised so typing, which re-renders the composer on every key, never re-renders the sheets.
const ComposerSheets = memo(function ComposerSheets({
  sheet,
  setSheet,
  openSheet,
  selection,
  onSelectAgent,
  context,
  onContextChange,
  onAttach,
  onCommand,
}: ComposerSheetsProps): ReactElement {
  // A sheet only ever closes itself: the "+" sheet reports closing after the next sheet has opened.
  const close = (name: Sheet): void =>
    setSheet(current => (current === name ? undefined : current));
  const bindSheet = (name: Sheet): { isOpen: boolean; onOpenChange: (open: boolean) => void } => ({
    isOpen: sheet === name,
    onOpenChange: (open): void => (open ? setSheet(name) : close(name)),
  });

  return (
    <>
      <PlusSheet
        {...bindSheet('plus')}
        selection={selection}
        collectionCount={context.filter(isCollectionPick).length}
        onOpen={openSheet}
        onAttach={onAttach}
      />
      <CollectionsSheet
        isOpen={sheet === 'collections'}
        onClose={(): void => close('collections')}
        selected={context}
        onApply={onContextChange}
      />
      <SlashCommandSheet
        {...bindSheet('commands')}
        onSelect={(name): void => {
          close('commands');
          onCommand(name);
        }}
      />
      <ContextPickerSheet
        isOpen={sheet === 'context'}
        onClose={(): void => close('context')}
        selected={context}
        onApply={onContextChange}
      />
      <AgentSheet
        {...bindSheet('agent')}
        agents={selection.agents}
        selected={selection.agentSlug}
        onSelect={(slug): void => {
          close('agent');
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
          close('model');
          selection.selectModel(model);
        }}
        onSelectThinkingLevel={(level): void => {
          close('model');
          selection.selectThinkingLevel(level);
        }}
      />
    </>
  );
});

export interface XyneAIComposerHandle {
  setText: (text: string) => void;
}

// The composer owns what is being written, so typing re-renders only the composer.
export const XyneAIComposer = ({
  ref,
  isStreaming,
  onSubmit,
  onStop,
  selection,
  onSelectAgent,
  onSheetChange,
  channel,
  thread,
  editing,
}: {
  ref: Ref<XyneAIComposerHandle>;
  isStreaming: boolean;
  onSubmit: (text: string, context: AttachedContextItem[], attachments: AttachedFile[]) => void;
  onStop: () => void;
  selection: XyneAISelection;
  onSelectAgent: (slug: string | undefined) => void;
  onSheetChange: (isOpen: boolean) => void;
  /** The channel this chat is scoped to, removable like any other tag. */
  channel: { label: string; onRemove: () => void } | undefined;
  /** The message thread this chat is about, removable like any other tag. */
  thread: { label: string; senderId: string | undefined; onRemove: () => void } | undefined;
  /** Set while a sent message is being rewritten; removing it cancels the edit. */
  editing: { onCancel: () => void } | undefined;
}): ReactElement => {
  const [text, setText] = useState('');
  const [context, setContext] = useState<AttachedContextItem[]>([]);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [sheet, setSheet] = useState<Sheet>();
  const [cursor, setCursor] = useState(0);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number }>();
  const { theme } = useUniwind();
  const surfaceColor = useCSSVariable('--color-conversation-input-bg') as string;
  const textColor = useCSSVariable('--color-conversation-input-text') as string;
  const iconColor = useCSSVariable('--color-conversation-input-toolbar-icon') as string;

  useEffect(() => onSheetChange(sheet !== undefined), [sheet, onSheetChange]);

  const openSheet = useCallback((name: Sheet): void => {
    Keyboard.dismiss();
    setSheet(name);
  }, []);
  const dictation = useDictation(text, setText);
  useImperativeHandle(ref, () => ({
    setText: (next: string): void => {
      dictation.interrupt();
      setText(next);
    },
  }));
  const onCommand = useCallback(
    (name: string): void => setText(current => withCommand(current, name)),
    [],
  );
  const attach = useCallback(
    (pickFiles: AttachmentPicker): void => {
      const remainingSlots = MAX_FILES - attachments.length;
      const pick = async (): Promise<AttachedFile[]> => {
        if (remainingSlots <= 0) throw new Error(`Maximum ${MAX_FILES} attachments allowed.`);
        const picked = await pickFiles([], Math.min(remainingSlots, MAX_COMPOSER_ATTACHMENT_COUNT));
        const error = fileLimitError(attachments, picked);
        if (error) throw new Error(error);
        return Promise.all(picked.map(toAttachedFile));
      };
      pick().then(
        added => setAttachments(current => [...current, ...added]),
        (error: unknown) =>
          Alert.alert('Could not attach files', error instanceof Error ? error.message : undefined),
      );
    },
    [attachments],
  );

  const { agent, modes } = selection;
  const hasTags =
    agent !== undefined ||
    channel !== undefined ||
    thread !== undefined ||
    editing !== undefined ||
    modes.webSearch.enabled ||
    modes.deepResearch.enabled ||
    context.length + attachments.length > 0;

  const submit = (value = text): void => {
    if (value.trim() === '') return;
    onSubmit(value, context, attachments);
    setText('');
    setContext([]);
    setAttachments([]);
  };

  const trigger = useMemo(() => activeMention(text, cursor), [text, cursor]);

  // A "/" starting the message opens the commands picker instead of being typed.
  const handleChangeText = (next: string): void => {
    dictation.interrupt();
    if (text === '' && next === '/') openSheet('commands');
    else setText(next);
  };

  const pickMention = (pick: AttachedContextItem, label: string): void => {
    if (!trigger) return;
    const inserted = insertMention(text, trigger, cursor, label);
    setText(inserted.text);
    setCursor(inserted.cursor);
    setForcedSelection({ start: inserted.cursor, end: inserted.cursor });
    setContext(current =>
      current.some(item => pickKey(item) === pickKey(pick)) ? current : togglePick(current, pick),
    );
  };

  const toolbar =
    dictation.status === 'listening' ? (
      <>
        <ToolbarButton label='Cancel dictation' onPress={dictation.cancel}>
          <X size={20} color={iconColor} />
        </ToolbarButton>
        <DictationWaveform height={TOOLBAR_BUTTON_SIZE} />
        <ToolbarButton label='Stop dictation' onPress={(): void => void dictation.stop()}>
          <Square size={14} color={iconColor} fill={iconColor} />
        </ToolbarButton>
      </>
    ) : (
      <>
        <ToolbarButton label='Add to message' onPress={(): void => openSheet('plus')}>
          <Plus size={22} color={iconColor} />
        </ToolbarButton>
        <ModelPill selection={selection} onPress={(): void => openSheet('model')} />
        <View className='flex-1' />
        <ToolbarButton
          label='Dictate'
          disabled={dictation.status === 'stopping'}
          onPress={(): void => {
            Keyboard.dismiss();
            void dictation.start();
          }}
        >
          <Mic size={20} color={iconColor} />
        </ToolbarButton>
      </>
    );
  const sendButton = (
    <SendButton
      isStreaming={isStreaming}
      canSend={text.trim() !== ''}
      onPress={(): void => {
        void haptics.buttonTap();
        if (isStreaming) onStop();
        else if (dictation.status === 'idle') submit();
        else void dictation.stop().then(submit);
      }}
    />
  );

  return (
    <>
      {trigger && sheet === undefined ? (
        <MentionSuggestions
          trigger={trigger}
          onPickUser={({ id, name }: MentionUserOption): void =>
            pickMention(personPick(id, name), name)
          }
          onPickChannel={({ id, name }: MentionChannelOption): void =>
            pickMention(channelPick(id, name), name)
          }
        />
      ) : null}
      <View
        className='overflow-hidden border-border'
        style={{ borderRadius: COMPOSER_RADIUS, borderWidth: StyleSheet.hairlineWidth }}
      >
        <GlassSurface
          fallbackColor={surfaceColor}
          colorScheme={theme === 'dark' ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { borderRadius: COMPOSER_RADIUS }]}
        />
        {hasTags ? (
          <ChipRow className='grow-0 px-3 pt-3'>
            {editing ? (
              <Chip
                label='Editing message'
                iconColor={iconColor}
                leading={<Pencil size={13} color={iconColor} />}
                onPress={editing.onCancel}
              />
            ) : null}
            {channel ? (
              <Chip
                label={channel.label}
                iconColor={iconColor}
                leading={<Hash size={13} color={iconColor} />}
                onPress={channel.onRemove}
              />
            ) : null}
            {thread ? (
              <Chip
                label={thread.label}
                iconColor={iconColor}
                leading={
                  thread.senderId ? (
                    <Avatar userIds={[thread.senderId]} size={16} />
                  ) : (
                    <MessageCircleMore size={13} color={iconColor} />
                  )
                }
                onPress={thread.onRemove}
              />
            ) : null}
            {agent ? (
              <Chip
                label={agent.name}
                iconColor={iconColor}
                leading={<AgentDot color={agent.color} />}
                onPress={(): void => onSelectAgent(undefined)}
              />
            ) : null}
            <ModeChip icon={Globe} label='Web search' mode={modes.webSearch} />
            <ModeChip icon={Target} label='Deep search' mode={modes.deepResearch} />
            {context.map(item => {
              const Icon = ICONS[item.type];
              return (
                <Chip
                  key={`${item.type}:${item.id}`}
                  label={item.title}
                  iconColor={iconColor}
                  leading={Icon ? <Icon size={13} color={iconColor} /> : undefined}
                  onPress={(): void =>
                    setContext(current => current.filter(other => other !== item))
                  }
                />
              );
            })}
            {attachments.map((file, index) => (
              <Chip
                key={`${index}:${file.filename}`}
                label={file.filename}
                iconColor={iconColor}
                leading={<Paperclip size={13} color={iconColor} />}
                onPress={(): void =>
                  setAttachments(current => current.filter(other => other !== file))
                }
              />
            ))}
          </ChipRow>
        ) : null}
        <TextInput
          multiline
          value={text}
          onChangeText={handleChangeText}
          onSelectionChange={({ nativeEvent }): void => {
            setCursor(nativeEvent.selection.end);
            setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          className='px-4 pb-1 pt-3'
          style={[styles.input, { color: textColor }]}
        />
        <View className='flex-row items-center gap-2 px-2 pb-2 pt-1'>
          {toolbar}
          {sendButton}
        </View>
        <ComposerSheets
          sheet={sheet}
          setSheet={setSheet}
          openSheet={openSheet}
          selection={selection}
          onSelectAgent={onSelectAgent}
          context={context}
          onContextChange={setContext}
          onAttach={attach}
          onCommand={onCommand}
        />
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  input: {
    fontSize: INPUT_FONT_SIZE,
    maxHeight: INPUT_MAX_HEIGHT,
    textAlignVertical: 'top',
    // On iOS a TextInput lineHeight pins the text to the bottom of each line.
    ...(Platform.OS === 'android' && { lineHeight: INPUT_LINE_HEIGHT }),
  },
});
