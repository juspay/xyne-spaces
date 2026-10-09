import { aiSendButtonTrackingMetadata } from '../../services/Analytics/xyneAiTracking';
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { Lock, MousePointerClick, Sparkles, TextQuote, Box } from 'lucide-react';
import { toast } from 'sonner';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';
import { commandsForSurface } from '@xyne/shared/commands';
import { fetchClawAgentModels } from '../../services/clawAgentModelsService';
import { useVoiceMode } from '../Voice/useVoiceMode';
import { VoiceModeBar } from '../Voice/VoiceModeBar';
import type { StreamState } from '../../services/XyneAI';
import { detectStudioIntent } from './voice/studioIntent';
import { apiInstance } from '../../services/clients/apiClient';
import {
  attachedContextToSelections,
  type ContextSelections,
  type AttachedContextItem,
} from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import type { UserTag } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { EMPTY_COMPOSER_CONTEXT, type ComposerContext } from './composerContext';
import { SANDBOX_MODE_OPTIONS, useSandboxMode } from './SandboxModeSwitch';
import { useDesignStudio } from './Workspace/design/designStudioContext';
import { usePageSelection } from './Workspace/pageSelectionContext';
import { fetchAccessibleClawAgents } from '../../services/clawAgentListService';
import {
  rememberNoAgentChoice,
  useDefaultAgent,
  useSelectedAgent,
} from '../../hooks/useSelectedAgent';
import { useAskAIAuto } from '../../hooks/useAskAIAuto';
import { useRoutedSubmit, type AssistantRouting } from '../Assistant/useRoutedSubmit';
import { Composer } from '../Composer/Composer';
import type {
  ComposerHandle,
  ComposerTrayItem,
  ContextRef,
  PickedContext,
  ThinkingLevel,
} from '../Composer/Composer.types';
import { addPicked, pickedRefsOf, removePicked } from '../Composer/Composer.utils';
import {
  PlusMenuChoice,
  knowledgeTrayItems,
  selectionTrayItems,
} from '../Composer/ComposerControls';

export interface AIComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  data: string;
  mimeType: string;
  filename: string;
}

export interface AIComposerHandle {
  addFiles: (files: File[]) => void;
  clearContent: () => void;
  focus: () => void;
  setPrompt: (value: string) => void;
  /** Submit `text` as its own turn, carrying the composer's current context
   *  (agent, model, toggles) but not its draft or attachments — those stay
   *  put. False when refused because a reply is still streaming. */
  submitPrompt: (text: string) => boolean;
  /** REPLACE the composer's editable context with these items (empty clears it).
   *  Used on chat switch to carry the opened conversation's last-turn context
   *  into the composer. */
  setContext: (items: AttachedContextItem[]) => void;
}

interface AIComposerProps {
  autoFocus?: boolean;
  onSubmit?: (
    text: string,
    attachments?: AIComposerAttachment[],
    context?: ComposerContext,
    /** Which affordance sent it — the button already has its own click row. */
    trigger?: 'button' | 'enter' | 'programmatic',
  ) => void;
  placeholder?: string;
  hideDisclaimer?: boolean;
  pending?: boolean;
  onStop?: () => void;
  assistant?: AssistantRouting | undefined;
  /** Fires when the user picks a different agent, so the parent can open a
   *  fresh chat for that agent. The current composer context is passed along so
   *  the parent can preserve the user's selections (channels, KB, web search,
   *  …) across the agent switch — but never the model pin, which belongs to
   *  the previous agent's model list. */
  onAgentChange?: ((slug: string | null, context: ComposerContext) => void) | undefined;
  showAgentSelector?: boolean;
  /** Seeds the extra context/toggles (web search, deep research, collections,
   *  etc.) — used for the landing → chat handoff so the chat composer starts
   *  with whatever the user selected on the landing page. */
  initialExtras?: ComposerContext | undefined;
  /** Fires whenever the composer's context/toggles change. The parent tracks
   *  the latest snapshot so selections survive switching to a recent chat,
   *  matching XyneAISidebar (where composer state lives in the parent). */
  onContextChange?: ((context: ComposerContext) => void) | undefined;
  /** Which edge stays put: 'top' on the landing page (grows and opens menus
   *  downward), 'bottom' in a chat. See the Composer's `anchor`. */
  anchor?: 'top' | 'bottom';
}

interface XyneAIConfigResponse {
  webSearchAccessible: boolean;
  deepResearchAccessible: boolean;
  v2Enabled?: boolean;
}

// File attachment limits — kept in sync with claw-auth's run-stream
// rehydration caps (xyne-claw-auth/backend/src/routes/run-stream.ts).
const MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MiB
const MAX_ATTACHMENTS = 20;

const blockedExtensions = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  if (str.length % 4 !== 0) return false;
  return true;
};

const startedOnAIPage = (state: StreamState): boolean => state.startedOnAIPage === true;

/**
 * The /ai page composer: the shared {@link Composer} plus the state the AI
 * screen owns — its context, toggles, attachments, model pin, design-studio
 * hand-offs and voice mode.
 */
export const AIComposer = forwardRef<AIComposerHandle, AIComposerProps>(function AIComposer(
  {
    autoFocus,
    onSubmit,
    placeholder,
    pending = false,
    onStop,
    assistant,
    hideDisclaimer,
    onAgentChange,
    showAgentSelector = true,
    initialExtras,
    onContextChange,
    anchor = 'bottom',
  },
  ref,
): ReactElement {
  const seed = initialExtras ?? EMPTY_COMPOSER_CONTEXT;
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<AIComposerAttachment[]>([]);
  const [selections, setSelections] = useState<ContextSelections>(() => ({
    channels: seed.channels,
    tickets: seed.tickets,
    canvases: seed.canvases,
    transcripts: seed.transcripts,
    recordings: seed.recordings,
    messages: seed.messages,
    people: seed.people,
    sharedFiles: seed.sharedFiles,
    localFolders: seed.localFolders,
  }));
  const [userTags, setUserTags] = useState<Record<string, UserTag>>({});
  const [collections, setCollections] = useState(() => seed.collections);
  const [fileScopes, setFileScopes] = useState(() => seed.fileScopes);
  const [folderScopes, setFolderScopes] = useState(() => seed.folderScopes);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => seed.webSearchEnabled);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(() => seed.deepResearchEnabled);
  const [createCanvasEnabled, setCreateCanvasEnabled] = useState(() => seed.createCanvasEnabled);
  const [voiceMode, setVoiceMode] = useState(() => seed.voiceMode);
  const [voiceStudioMode, setVoiceStudioMode] = useState<string | null>(() => seed.voiceStudioMode);
  // Per-run model pin + thinking level. The list is the selected agent's
  // models; null = Auto, the model configured on the agent. Both reset when
  // the agent changes — one agent's pick may not exist on another's list.
  const [selectedModel, setSelectedModel] = useState<string | null>(() => seed.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | null>(
    () => seed.thinkingLevel,
  );
  const [dismissedStudioIntent, setDismissedStudioIntent] = useState<string | null>(null);
  const [sandboxMode, setSandboxMode] = useSandboxMode();
  const composerRef = useRef<ComposerHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Picks can land faster than a render (two quick @ picks), so caps are
  // checked against the latest selections, not the rendered ones.
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;
  const designStudio = useDesignStudio();
  const designMode = designStudio?.designMode ?? null;
  const pendingSelection = designStudio?.pendingSelection ?? null;
  const pageSelection = usePageSelection();
  const pageSelectionValue = pageSelection?.selection ?? null;

  const { selectedAgentSlug, setSelectedAgentSlug } = useSelectedAgent();
  const { isAuto, setAuto } = useAskAIAuto();
  const isAutoOn = isAuto && assistant !== undefined && selectedAgentSlug === null;
  const { data: agents = [] } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 5 * 60 * 1000,
  });
  useDefaultAgent(agents);
  const selectedAgent = useMemo(
    () => agents.find(a => a.slug === selectedAgentSlug) ?? null,
    [agents, selectedAgentSlug],
  );
  // Locked, not a toggle: an instant agent always runs instant, server-side.
  const instant = selectedAgent?.instantAgent === true;

  const modelAgentSlug = selectedAgentSlug ?? 'ask-ai';
  const {
    data: agentModelsData,
    isPlaceholderData: modelsArePreviousAgent,
    isLoading: modelsLoading,
  } = useQuery({
    queryKey: ['claw-agent-models', modelAgentSlug],
    queryFn: () => fetchClawAgentModels(modelAgentSlug),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  // Reset the pin/thinking picks when the AGENT changes — but not on mount,
  // where they may be seeded from initialExtras (landing → chat handoff).
  const prevModelAgentSlug = useRef(modelAgentSlug);
  useEffect(() => {
    if (prevModelAgentSlug.current === modelAgentSlug) return;
    if (modelsArePreviousAgent) return;
    prevModelAgentSlug.current = modelAgentSlug;
    setSelectedModel(null);
    setThinkingLevel(null);
  }, [modelAgentSlug, modelsArePreviousAgent]);
  // A seeded pin the agent can't serve is dropped once its list is known.
  useEffect(() => {
    if (!agentModelsData || modelsArePreviousAgent || selectedModel === null) return;
    if (!agentModelsData.models.some(m => m.id === selectedModel)) setSelectedModel(null);
  }, [agentModelsData, modelsArePreviousAgent, selectedModel]);

  const effectiveModel = modelsArePreviousAgent ? null : selectedModel;
  const effectiveThinkingLevel = modelsArePreviousAgent ? null : thinkingLevel;

  const { data: configData } = useQuery<XyneAIConfigResponse>({
    queryKey: ['xyne-ai-config'],
    queryFn: async (): Promise<XyneAIConfigResponse> => {
      const response = await apiInstance.get<XyneAIConfigResponse>('/xyne-ai/config');
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const webSearchAccessible = configData?.webSearchAccessible ?? false;
  const deepResearchAccessible = configData?.deepResearchAccessible ?? false;
  const modelPinProvider = agentModelsData?.pinProvider ?? 'litellm';

  const buildContext = useCallback(
    (): ComposerContext => ({
      channels: selections.channels,
      tickets: selections.tickets,
      canvases: selections.canvases,
      transcripts: selections.transcripts,
      recordings: selections.recordings,
      messages: selections.messages ?? [],
      people: selections.people ?? [],
      sharedFiles: selections.sharedFiles ?? [],
      userTags,
      localFolders: selections.localFolders,
      collections,
      fileScopes,
      folderScopes,
      research: null,
      webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
      deepResearchEnabled: deepResearchAccessible ? deepResearchEnabled : false,
      createCanvasEnabled,
      voiceMode,
      voiceStudioMode,
      instant,
      model: effectiveModel,
      modelProvider: !effectiveModel
        ? null
        : effectiveModel.startsWith('local-harness:')
          ? 'local-harness'
          : modelPinProvider,
      thinkingLevel: effectiveThinkingLevel,
      sandboxMode,
    }),
    [
      selections,
      userTags,
      collections,
      fileScopes,
      folderScopes,
      webSearchEnabled,
      deepResearchEnabled,
      createCanvasEnabled,
      voiceMode,
      voiceStudioMode,
      instant,
      effectiveModel,
      sandboxMode,
      modelPinProvider,
      effectiveThinkingLevel,
      webSearchAccessible,
      deepResearchAccessible,
    ],
  );

  // Report the latest context up to the parent (via a ref so an inline
  // onContextChange doesn't refire this every render). Lets AIScreen preserve
  // the user's selections when switching to a recent chat.
  const onContextChangeRef = useRef(onContextChange);
  useEffect(() => {
    onContextChangeRef.current = onContextChange;
  });
  useEffect(() => {
    onContextChangeRef.current?.(buildContext());
  }, [buildContext]);

  /** Context handed to a fresh chat for another agent — without this agent's model pin. */
  const contextForAgentSwitch = (): ComposerContext => ({
    ...buildContext(),
    model: null,
    modelProvider: null,
    thinkingLevel: null,
  });

  const handleFilesAdded = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;

      const validFiles = files.filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return !ext || !blockedExtensions.has(`.${ext}`);
      });

      if (validFiles.length === 0) {
        toast.error('The selected file type is not allowed for security reasons.', {
          duration: 3000,
        });
        return;
      }

      const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
      if (oversizedFiles.length > 0) {
        const fileNames = oversizedFiles.map(f => f.name).join(', ');
        toast.error(`File(s) too large: ${fileNames}. Maximum file size is 10MB.`, {
          duration: 4000,
        });
        return;
      }

      const remaining = MAX_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
        return;
      }
      const allowedFiles = validFiles.slice(0, remaining);
      if (validFiles.length > remaining) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
      }

      const existingTotalSize = attachments.reduce((sum, att) => sum + att.size, 0);
      const newFilesSize = allowedFiles.reduce((sum, file) => sum + file.size, 0);
      if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
        const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
        toast.error(
          `Total attachment size (${totalMB}MB) exceeds the 25MB limit. Please remove some attachments.`,
          { duration: 4000 },
        );
        return;
      }

      const filePromises = allowedFiles.map(
        file =>
          new Promise<AIComposerAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (): void => {
              const result = reader.result as string;
              const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (!base64Match) {
                reject(
                  new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
                );
                return;
              }
              const [, , base64Data] = base64Match;
              if (!base64Data) {
                reject(new Error(`Empty file data for file: ${file.name}`));
                return;
              }
              if (!isValidBase64(base64Data)) {
                reject(new Error(`Invalid base64 data for file: ${file.name}`));
                return;
              }
              resolve({
                id: `${file.name}-${Date.now()}-${Math.random()}`,
                name: file.name,
                size: file.size,
                type: file.type,
                file,
                data: base64Data,
                mimeType: file.type,
                filename: file.name,
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      );

      try {
        const newAttachments = await Promise.all(filePromises);
        setAttachments(prev => [...prev, ...newAttachments]);
        if (newAttachments.length > 1) {
          toast.success(`${newAttachments.length} files attached successfully`, { duration: 2000 });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Error reading files. Please try again.';
        toast.error(errorMessage, { duration: 3000 });
      }
    },
    [attachments],
  );

  // ── Studio intent ("make a deck…" → /design) ──────────────────────────────
  const studioSuggestion = useMemo(() => detectStudioIntent(value), [value]);
  const showStudioSuggestion =
    !!studioSuggestion &&
    dismissedStudioIntent !== studioSuggestion.name &&
    !(designMode?.active && studioSuggestion.name === 'design');
  const activeStudioMode = showStudioSuggestion ? studioSuggestion : null;
  const applyStudioMode = useCallback(
    (text: string): string => {
      if (!activeStudioMode) return text;
      if (text.trimStart().startsWith('/')) return text;
      return `/${activeStudioMode.name} ${text.trim()}`;
    },
    [activeStudioMode],
  );

  /** Context in the tray belongs to the message it went out with — the sent
   *  message keeps its own copy. Only the local folder (where the agent works)
   *  and the search/canvas toggles stay for the chat. */
  const clearPicked = useCallback((): void => {
    const next: ContextSelections = {
      ...selectionsRef.current,
      channels: [],
      tickets: [],
      canvases: [],
      transcripts: [],
      recordings: [],
      messages: [],
      people: [],
      sharedFiles: [],
    };
    selectionsRef.current = next;
    setSelections(next);
    setUserTags({});
    setCollections([]);
    setFileScopes([]);
    setFolderScopes([]);
  }, []);

  function send(trigger: 'button' | 'enter'): void {
    onSubmit?.(
      applyStudioMode(value.trim()),
      attachments.length > 0 ? attachments : undefined,
      buildContext(),
      trigger,
    );
    setValue('');
    setAttachments([]);
    setDismissedStudioIntent(null);
    clearPicked();
  }

  const routedSubmit = useRoutedSubmit<'button' | 'enter'>({
    assistant,
    value,
    clear: () => setValue(''),
    submit: send,
  });

  function submit(trigger: 'button' | 'enter'): void {
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    // An explicit command is never re-routed by Auto.
    const isRoutable =
      isAutoOn &&
      attachments.length === 0 &&
      !trimmed.startsWith('/') &&
      applyStudioMode(trimmed) === trimmed;
    if (isRoutable && routedSubmit.route(trigger)) return;
    send(trigger);
  }

  const handleStop = (): void => {
    if (routedSubmit.stop()) return;
    onStop?.();
  };

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files: File[]): void => {
        if (files.length > 0) void handleFilesAdded(files);
      },
      clearContent: (): void => {
        setValue('');
        setAttachments([]);
      },
      focus: (): void => composerRef.current?.focus(),
      setPrompt: (nextValue: string): void => {
        setValue(nextValue);
        window.setTimeout(() => composerRef.current?.focus(), 0);
      },
      submitPrompt: (text: string): boolean => {
        if (pending) return false;
        const trimmed = text.trim();
        if (!trimmed) return false;
        onSubmit?.(trimmed, undefined, buildContext(), 'programmatic');
        return true;
      },
      setContext: (items: AttachedContextItem[]): void => {
        const next = attachedContextToSelections(items);
        setSelections({
          channels: next.channels,
          tickets: next.tickets,
          canvases: next.canvases,
          transcripts: next.transcripts,
          recordings: next.recordings,
          messages: next.messages ?? [],
          people: next.people ?? [],
          sharedFiles: next.sharedFiles ?? [],
          localFolders: next.localFolders,
        });
        setCollections(next.collections);
        setFileScopes(next.fileScopes);
        setFolderScopes(next.folderScopes);
      },
    }),
    [handleFilesAdded, pending, onSubmit, buildContext],
  );

  // ── Voice mode ─────────────────────────────────────────────────────────────
  const submitTranscript = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const intent = detectStudioIntent(trimmed);
      const studioLabel = intent?.label ?? null;
      setVoiceStudioMode(studioLabel);
      const task = intent ? `/${intent.name} ${trimmed}` : trimmed;
      onSubmit?.(task, undefined, {
        ...buildContext(),
        voiceMode: true,
        voiceStudioMode: studioLabel,
      });
      clearPicked();
    },
    [onSubmit, buildContext, clearPicked],
  );
  const answerTranscript = useMemo(
    () =>
      isAutoOn && assistant
        ? async (text: string): Promise<string | null> =>
            detectStudioIntent(text) ? null : assistant.answer(text)
        : undefined,
    [isAutoOn, assistant],
  );
  const voice = useVoiceMode({
    enabled: voiceMode,
    submit: submitTranscript,
    ownsStream: startedOnAIPage,
    ...(answerTranscript && { answer: answerTranscript }),
  });

  // ── Context: picks, pills ──────────────────────────────────────────────────
  const kbCount = collections.length + fileScopes.length + folderScopes.length;
  const handlePick = useCallback(
    (item: PickedContext): boolean => {
      const result = addPicked(selectionsRef.current, item, kbCount);
      if ('error' in result) {
        toast.error(result.error, { duration: 2500 });
        return false;
      }
      selectionsRef.current = result.next;
      setSelections(result.next);
      return true;
    },
    [kbCount],
  );
  const handleUnpick = useCallback((target: ContextRef): void => {
    setSelections(s => removePicked(s, target));
  }, []);
  const pickedRefs = useMemo(() => pickedRefsOf(selections), [selections]);

  const trayItems = useMemo<ComposerTrayItem[]>(() => {
    const items: ComposerTrayItem[] = [];
    if (designMode?.active) {
      items.push({
        key: 'design-lock',
        icon: <Lock className='size-3.5' aria-hidden />,
        label: '/design',
        title: 'Design is locked: every message runs /design. Remove to send plain messages.',
        onRemove: () => designMode.exit(),
      });
    }
    if (pendingSelection) {
      items.push({
        key: 'design-selection',
        icon: <MousePointerClick className='size-4' aria-hidden />,
        label: pendingSelection.label,
        title: `Your next message applies to this ${pendingSelection.scope}: <${pendingSelection.tagName}> ${pendingSelection.label}`,
        onRemove: () => designStudio?.clearPendingSelection(),
      });
    }
    if (pageSelectionValue) {
      items.push({
        key: 'page-selection',
        icon: <TextQuote className='size-4' aria-hidden />,
        label: pageSelectionValue.text,
        title: `Your next message applies to this passage from ${pageSelectionValue.title}:\n\n${pageSelectionValue.text.slice(0, 400)}`,
        onRemove: () => pageSelection?.clearSelection(),
      });
    }
    if (activeStudioMode) {
      items.push({
        key: `studio-${activeStudioMode.name}`,
        icon: <Sparkles className='size-4' aria-hidden />,
        label: activeStudioMode.label,
        title: `This message will run as /${activeStudioMode.name}. Remove to send it as a normal message.`,
        tone: 'accent',
        onRemove: () => setDismissedStudioIntent(activeStudioMode.name),
      });
    }
    items.push(...selectionTrayItems(selections, handleUnpick));
    items.push(
      ...knowledgeTrayItems(collections, folderScopes, fileScopes, {
        collection: id => setCollections(prev => prev.filter(c => c.id !== id)),
        folder: id => setFolderScopes(prev => prev.filter(f => f.id !== id)),
        file: id => setFileScopes(prev => prev.filter(f => f.id !== id)),
      }),
    );
    return items;
  }, [
    designMode,
    designStudio,
    pendingSelection,
    pageSelection,
    pageSelectionValue,
    activeStudioMode,
    selections,
    handleUnpick,
    collections,
    folderScopes,
    fileScopes,
  ]);

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) void handleFilesAdded(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const aiScreenCommands = useMemo(() => commandsForSurface('ai-screen'), []);
  const harnessAvailable = (agentModelsData?.models ?? []).some(
    m => m.provider === 'local-harness',
  );

  if (voiceMode) {
    return (
      <div className='relative'>
        <VoiceModeBar
          phase={voice.phase}
          studioMode={voiceStudioMode}
          onHoldStart={voice.startRecording}
          onHoldEnd={voice.stopRecording}
          onExit={() => setVoiceMode(false)}
        />
      </div>
    );
  }

  return (
    <div className='relative'>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        onChange={handleFileInputChange}
        className='hidden'
        aria-label='Upload files'
      />
      <Composer
        ref={composerRef}
        value={value}
        onValueChange={setValue}
        {...(placeholder ? { placeholder } : {})}
        {...(autoFocus ? { autoFocus } : {})}
        isStreaming={pending}
        anchor={anchor}
        onSubmit={submit}
        onStop={handleStop}
        sendTrackingMetadata={JSON.stringify(
          aiSendButtonTrackingMetadata({
            surface: 'page',
            model: effectiveModel,
            thinkingLevel: effectiveThinkingLevel,
            webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
            deepResearchEnabled: deepResearchAccessible ? deepResearchEnabled : false,
            createCanvasEnabled,
            attachmentsCount: attachments.length,
          }),
        )}
        trayItems={trayItems}
        attachments={attachments.map(a => ({
          key: a.id,
          file: a.file,
          onRemove: (): void => setAttachments(prev => prev.filter(att => att.id !== a.id)),
        }))}
        pickedRefs={pickedRefs}
        onPick={handlePick}
        onUnpick={handleUnpick}
        onUserTagsChange={setUserTags}
        commands={aiScreenCommands}
        plus={{
          onAttachFiles: () => fileInputRef.current?.click(),
          knowledge: {
            agent: selectedAgent,
            collections,
            folders: folderScopes,
            files: fileScopes,
            onChange: next => {
              setCollections(next.collections);
              setFolderScopes(next.folders);
              setFileScopes(next.files);
            },
          },
          createCanvasEnabled,
          onCreateCanvasToggle: () => setCreateCanvasEnabled(v => !v),
          webSearchEnabled: webSearchAccessible && webSearchEnabled,
          webSearchAccessible,
          onWebSearchToggle: () => {
            if (webSearchAccessible) setWebSearchEnabled(v => !v);
          },
          deepResearchEnabled: deepResearchAccessible && deepResearchEnabled,
          deepResearchAccessible,
          onDeepResearchToggle: () => {
            if (deepResearchAccessible) setDeepResearchEnabled(v => !v);
          },
          ...(harnessAvailable && {
            extra: (
              <PlusMenuChoice
                icon={<Box className='size-[18px] shrink-0 text-muted-foreground' aria-hidden />}
                label='Sandbox'
                value={sandboxMode}
                options={SANDBOX_MODE_OPTIONS.map(o => ({
                  value: o.value,
                  label: o.shortLabel,
                  description: o.description,
                }))}
                onChange={setSandboxMode}
                disabled={pending}
                trackName='SELECT_SANDBOX_MODE'
              />
            ),
          }),
        }}
        agent={
          showAgentSelector
            ? {
                agents,
                selectedSlug: selectedAgentSlug,
                isAuto: isAutoOn,
                canAuto: assistant !== undefined,
                disabled: pending,
                onSelect: (slug): void => {
                  setAuto(false);
                  if (slug === null) rememberNoAgentChoice('ask-ai');
                  if (slug === selectedAgentSlug) return;
                  setSelectedAgentSlug(slug);
                  onAgentChange?.(slug, contextForAgentSwitch());
                },
                onSelectAuto: (): void => {
                  setAuto(true);
                  rememberNoAgentChoice('auto');
                  if (selectedAgentSlug !== null) {
                    setSelectedAgentSlug(null);
                    onAgentChange?.(null, contextForAgentSwitch());
                  }
                },
              }
            : null
        }
        model={{
          models: modelsArePreviousAgent ? [] : (agentModelsData?.models ?? []),
          defaultModel: modelsArePreviousAgent ? null : (agentModelsData?.defaultModel ?? null),
          defaultModelName: modelsArePreviousAgent
            ? null
            : (agentModelsData?.defaultModelName ?? null),
          selectedModel: effectiveModel,
          onSelectModel: setSelectedModel,
          thinkingLevel: effectiveThinkingLevel,
          onSelectThinking: setThinkingLevel,
          loading: modelsArePreviousAgent || modelsLoading,
          disabled: pending,
        }}
        onEnterVoiceMode={() => setVoiceMode(true)}
        onFilesPasted={files => void handleFilesAdded(files)}
      />
      {hideDisclaimer ? null : (
        <p className='mt-1.5 text-center text-[11px] text-muted-foreground/80'>
          Xyne can make mistakes. Verify important details.
        </p>
      )}
    </div>
  );
});
