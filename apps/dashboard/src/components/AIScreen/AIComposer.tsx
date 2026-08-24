import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type FormEvent,
  type KeyboardEvent,
  type ClipboardEvent,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  FileText,
  Globe,
  Microscope,
  File as FileIcon,
  BookOpen,
  Ticket,
  Phone,
  Mic,
  Hash,
  Lock,
  Zap,
  Brain,
  ChevronDown,
  ChevronRight,
  Check,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';
import { AIAgentSelector } from './AIAgentSelector';
import { formatModelLabel } from '../Chat/XyneAISidebar/components/ModelSelector';
import type { ClawAgentModel } from '../../services/clawAgentModelsService';
import { fetchClawAgentModels } from '../../services/clawAgentModelsService';
import { Popover } from '../ui/Popover';
import { ComposerCollectionPicker } from './ComposerCollectionPicker';
import { ComposerVoiceButton } from './ComposerVoiceButton';
import { cn } from '../../utils/classNames';
import { apiInstance } from '../../services/clients/apiClient';
import {
  ContextPickerPanel,
  type ContextSelections,
} from '../Chat/XyneAISidebar/components/ContextPickerPanel';
import { EMPTY_COMPOSER_CONTEXT, type ComposerContext } from './composerContext';
import { fetchAccessibleClawAgents } from '../../services/clawAgentListService';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';

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
}

interface AIComposerProps {
  autoFocus?: boolean;
  onSubmit?: (
    text: string,
    attachments?: AIComposerAttachment[],
    context?: ComposerContext,
  ) => void;
  placeholder?: string;
  hideDisclaimer?: boolean;
  pending?: boolean;
  onStop?: () => void;
  /** Forwarded to AIAgentSelector — fires when the user picks a different
   *  agent, so the parent can open a fresh chat for that agent. The current
   *  composer context is passed along so the parent can preserve the user's
   *  selections (channels, KB, web search, …) across the agent switch, matching
   *  the XyneAISidebar behaviour. */
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
const LARGE_PASTE_THRESHOLD = 11500;

const blockedExtensions = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str)) return false;
  if (str.length % 4 !== 0) return false;
  return true;
};

// Small pill used for every attached-context chip in the toolbar row.
function ContextPill({
  icon,
  label,
  onRemove,
  accent,
}: {
  icon: ReactElement;
  label: string;
  onRemove: () => void;
  accent?: boolean;
}): ReactElement {
  return (
    <div className='flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2'>
      {icon}
      <span
        className={cn(
          'max-w-[140px] truncate text-[12.5px] font-medium',
          accent ? 'text-[#7C3AED]' : 'text-foreground',
        )}
      >
        {label}
      </span>
      <button
        type='button'
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className='ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition hover:bg-secondary hover:text-foreground'
        data-track-category='XyneAI'
        data-track-name='REMOVE_CONTEXT_PILL'
      >
        <X className='h-3 w-3' aria-hidden strokeWidth={2} />
      </button>
    </div>
  );
}

// Ghost toolbar button matching the /ai composer's look. `visibleText` is
// opt-in — when set, the button widens into a pill with the icon plus a text
// node instead of the default icon-only circle (used for the Instant toggle
// so it reads as a named mode, not just an icon other buttons could be
// mistaken for).
function ToolbarButton({
  icon,
  label,
  visibleText,
  onClick,
  active,
  activeClass,
  disabled,
  trackName,
}: {
  icon: ReactElement;
  label: string;
  visibleText?: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  trackName: string;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center rounded-full transition',
        visibleText ? 'gap-1 px-2.5' : 'w-8',
        active
          ? (activeClass ?? 'bg-secondary text-foreground')
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      data-track-category='XyneAI'
      data-track-name={trackName}
    >
      {icon}
      {visibleText && <span className='text-xs font-medium'>{visibleText}</span>}
    </button>
  );
}

/** Per-run thinking level for the composer. null = the agent's configured
 *  default. Applies to whichever provider serves the run (same precedence as
 *  the agent's modelSettings.thinkingLevel). */
const THINKING_LEVEL_OPTIONS: Array<{ value: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null; label: string }> = [
  { value: null, label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * Combined model + thinking picker, styled after the Claude app's model menu:
 * the trigger leads with the MODEL name ("Recommended" when no pin, with the
 * thinking level beside it when set), and the menu holds the Recommended row,
 * a search bar over the account's allowed models, and an expandable Thinking
 * section (Default / Off / Minimal / Low / Medium / High).
 */
function ModelThinkingSelector({
  models,
  defaultModel,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinking,
  disabled,
}: {
  models: ClawAgentModel[];
  defaultModel: string | null;
  selectedModel: string | null;
  onSelectModel: (m: string | null) => void;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  onSelectThinking: (v: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);

  const selected = useMemo(
    () => models.find(m => m.id === selectedModel) ?? null,
    [models, selectedModel],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [models, query]);
  const thinkingLabel = THINKING_LEVEL_OPTIONS.find(o => o.value === thinkingLevel)?.label ?? 'Default';

  const rowClass = (active: boolean) =>
    cn(
      'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 mx-0 text-left text-sm transition-colors',
      active ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-foreground',
    );

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) {
          setQuery('');
          setThinkingOpen(false);
        }
      }}
      align='end'
      sideOffset={4}
      trigger={
        <button
          type='button'
          disabled={disabled}
          title={selected ? selected.id : defaultModel ? `Recommended (${defaultModel})` : 'Recommended model'}
          aria-label='Model and thinking'
          data-track-category='XyneAI'
          data-track-name='OPEN_MODEL_SELECTOR'
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-sm transition-colors',
            disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent cursor-pointer',
          )}
        >
          <Sparkles className='h-3.5 w-3.5 shrink-0 text-primary' aria-hidden strokeWidth={1.75} />
          <span className='font-medium text-foreground truncate max-w-[160px]'>
            {selected ? formatModelLabel(selected.name) : 'Recommended'}
          </span>
          {thinkingLevel && <span className='text-muted-foreground'>{thinkingLabel}</span>}
          <ChevronDown className='h-3 w-3 shrink-0 text-muted-foreground' aria-hidden />
        </button>
      }
      className='w-72 p-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden'
    >
      <div className='flex flex-col py-1 px-1'>
        {/* Recommended — clears the pin; the run uses the model configured in the DB. */}
        <button
          type='button'
          onClick={() => {
            onSelectModel(null);
            setOpen(false);
          }}
          data-track-category='XyneAI'
          data-track-name='SELECT_MODEL'
          data-track-metadata='{"model":"recommended"}'
          className={rowClass(selectedModel === null)}
        >
          <span className='flex flex-col items-start gap-0.5'>
            <span className='font-medium'>Recommended</span>
            {defaultModel && (
              <span className='text-[11px] text-muted-foreground truncate max-w-full'>
                {formatModelLabel(defaultModel)}
              </span>
            )}
          </span>
          {selectedModel === null && <Check className='h-3.5 w-3.5 shrink-0' aria-hidden />}
        </button>

        {models.length > 0 && (
          <>
            <div className='my-1 h-px bg-border mx-1' />
            {/* Search over the account's allowed model list. */}
            <div className='flex items-center gap-1.5 rounded-md border border-border mx-1 my-0.5 px-2 py-1'>
              <Search className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Search models…'
                data-id='model-search'
                className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
              />
            </div>
            <div className='flex max-h-56 flex-col overflow-auto'>
              {filtered.length === 0 ? (
                <div className='px-2.5 py-2 text-sm text-muted-foreground'>No models match</div>
              ) : (
                filtered.map(m => (
                  <button
                    key={m.id}
                    type='button'
                    title={m.id}
                    onClick={() => {
                      onSelectModel(m.id);
                      setOpen(false);
                    }}
                    data-track-category='XyneAI'
                    data-track-name='SELECT_MODEL'
                    data-track-metadata={JSON.stringify({ model: m.id })}
                    className={rowClass(selectedModel === m.id)}
                  >
                    <span className='font-medium truncate'>{formatModelLabel(m.name)}</span>
                    {selectedModel === m.id && <Check className='h-3.5 w-3.5 shrink-0' aria-hidden />}
                  </button>
                ))
              )}
            </div>
          </>
        )}

        <div className='my-1 h-px bg-border mx-1' />
        {/* Thinking — expands inline to the level options. */}
        <button
          type='button'
          onClick={() => setThinkingOpen(v => !v)}
          data-id='thinking-expand'
          aria-expanded={thinkingOpen}
          className='flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent'
        >
          <span className='flex items-center gap-1.5 font-medium'>
            <Brain className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden strokeWidth={1.75} />
            Thinking
          </span>
          <span className='flex items-center gap-1 text-muted-foreground'>
            {thinkingLabel}
            {thinkingOpen ? (
              <ChevronDown className='h-3 w-3 shrink-0' aria-hidden />
            ) : (
              <ChevronRight className='h-3 w-3 shrink-0' aria-hidden />
            )}
          </span>
        </button>
        {thinkingOpen &&
          THINKING_LEVEL_OPTIONS.map(o => (
            <button
              key={o.label}
              type='button'
              onClick={() => {
                onSelectThinking(o.value);
                setOpen(false);
              }}
              data-id={`thinking-option-${o.label.toLowerCase()}`}
              className={cn('pl-8', rowClass(o.value === thinkingLevel))}
            >
              <span>{o.label}</span>
              {o.value === thinkingLevel && <Check className='h-3.5 w-3.5 shrink-0' aria-hidden />}
            </button>
          ))}
      </div>
    </Popover>
  );
}

export const AIComposer = forwardRef<AIComposerHandle, AIComposerProps>(function AIComposer(
  {
    autoFocus,
    onSubmit,
    placeholder = 'Ask anything',
    pending = false,
    onStop,
    hideDisclaimer,
    onAgentChange,
    showAgentSelector = true,
    initialExtras,
    onContextChange,
  },
  ref,
): ReactElement {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<AIComposerAttachment[]>([]);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Extra composer context/toggles (seeded from initialExtras once) ──────────
  const seed = initialExtras ?? EMPTY_COMPOSER_CONTEXT;
  const [showContextModal, setShowContextModal] = useState(false);
  const [selections, setSelections] = useState<ContextSelections>(() => ({
    channels: seed.channels,
    tickets: seed.tickets,
    canvases: seed.canvases,
    transcripts: seed.transcripts,
    recordings: seed.recordings,
  }));
  const [collections, setCollections] = useState(() => seed.collections);
  const [fileScopes, setFileScopes] = useState(() => seed.fileScopes);
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => seed.webSearchEnabled);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(() => seed.deepResearchEnabled);
  const [createCanvasEnabled, setCreateCanvasEnabled] = useState(() => seed.createCanvasEnabled);
  // Provider fast mode (⚡). Only meaningful — and only rendered — when the
  // selected agent has fast mode configured; buildContext forces it false
  // otherwise so a stale toggle can't ride along after switching agents.
  const [fastModeEnabled, setFastModeEnabled] = useState(() => seed.fastMode);
  // Per-run model pin + thinking level. The model list is the account's allowed
  // models off the selected agent's shared LiteLLM key; "Default" = the model
  // configured in the DB. Both reset when the agent changes — a pick from one
  // agent's list may not exist on another's.
  const [selectedModel, setSelectedModel] = useState<string | null>(() => seed.model);
  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'minimal' | 'low' | 'medium' | 'high' | null>(() => seed.thinkingLevel);

  // Locked, not a toggle — see xyne-claw-auth's AgentDetailLeftColumn.tsx
  // "Instant Agent" setting and ChatPageV3.tsx's matching indicator. Every
  // request to an instant agent always runs instant (enforced server-side
  // regardless of what this composer sends), so there's no per-message
  // choice; the same `['accessible-claw-agents']` query the agent selector
  // uses is free here via the React Query cache.
  const { selectedAgentSlug } = useSelectedAgent();
  const { data: composerAgents } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 5 * 60 * 1000,
  });
  const selectedAgent = useMemo(
    () => composerAgents?.find(a => a.slug === selectedAgentSlug) ?? null,
    [composerAgents, selectedAgentSlug],
  );
  const instant = selectedAgent?.instantAgent === true;
  const fastModeConfigured = selectedAgent?.fastModeConfigured === true;

  const modelAgentSlug = selectedAgentSlug ?? 'ask-ai';
  const { data: agentModelsData } = useQuery({
    queryKey: ['claw-agent-models', modelAgentSlug],
    queryFn: () => fetchClawAgentModels(modelAgentSlug),
    staleTime: 60_000,
  });
  useEffect(() => {
    setSelectedModel(null);
    setThinkingLevel(null);
  }, [modelAgentSlug]);

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

  const buildContext = useCallback(
    (): ComposerContext => ({
      channels: selections.channels,
      tickets: selections.tickets,
      canvases: selections.canvases,
      transcripts: selections.transcripts,
      recordings: selections.recordings,
      collections,
      fileScopes,
      research: null,
      webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
      deepResearchEnabled: deepResearchAccessible ? deepResearchEnabled : false,
      createCanvasEnabled,
      instant,
      fastMode: fastModeConfigured ? fastModeEnabled : false,
      model: selectedModel,
      thinkingLevel,
    }),
    [
      selections,
      collections,
      fileScopes,
      webSearchEnabled,
      deepResearchEnabled,
      createCanvasEnabled,
      instant,
      fastModeConfigured,
      fastModeEnabled,
      selectedModel,
      thinkingLevel,
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

  useEffect((): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${String(Math.min(el.scrollHeight, 200))}px`;
  }, [value]);

  useEffect((): void => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

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

  useImperativeHandle(
    ref,
    () => ({
      addFiles: (files: File[]): void => {
        if (files.length > 0) {
          void handleFilesAdded(files);
        }
      },
      clearContent: (): void => {
        setValue('');
        setAttachments([]);
      },
      focus: (): void => {
        textareaRef.current?.focus();
      },
      setPrompt: (nextValue: string): void => {
        setValue(nextValue);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      },
    }),
    [handleFilesAdded],
  );

  const submit = (): void => {
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit?.(trimmed, attachments.length > 0 ? attachments : undefined, buildContext());
    setValue('');
    setAttachments([]);
    // Toggles/context persist across turns (mirrors the sidebar), so they are
    // intentionally NOT reset here.
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const clipboard = e.clipboardData;
    const files = clipboard?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      void handleFilesAdded(Array.from(files));
      return;
    }

    const pastedText = clipboard?.getData('text');
    if (pastedText && pastedText.length > LARGE_PASTE_THRESHOLD) {
      e.preventDefault();
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(`Maximum ${MAX_ATTACHMENTS} attachments allowed.`, { duration: 3000 });
        return;
      }
      let fileName: string;
      let fileType: string;
      try {
        JSON.parse(pastedText);
        fileName = `pasted-text-${Date.now()}.json`;
        fileType = 'application/json';
      } catch {
        fileName = `pasted-text-${Date.now()}.txt`;
        fileType = 'text/plain';
      }
      const blob = new Blob([pastedText], { type: fileType });
      const file = new File([blob], fileName, { type: fileType });
      void handleFilesAdded([file]);
    }
  };

  const handleAttachClick = (): void => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void handleFilesAdded(Array.from(files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (attachmentId: string): void => {
    setAttachments(prev => prev.filter(att => att.id !== attachmentId));
  };

  // Append a voice transcript to the current textarea value.
  const handleTranscript = useCallback((text: string): void => {
    setValue(prev => (prev.trim().length > 0 ? `${prev.trimEnd()} ${text}` : text));
    textareaRef.current?.focus();
  }, []);

  const closeContextModal = useCallback((): void => {
    setShowContextModal(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const removeChannel = (id: string): void =>
    setSelections(s => ({ ...s, channels: s.channels.filter(c => c.id !== id) }));
  const removeTicket = (id: string): void =>
    setSelections(s => ({ ...s, tickets: s.tickets.filter(t => t.id !== id) }));
  const removeCanvas = (id: string): void =>
    setSelections(s => ({ ...s, canvases: s.canvases.filter(c => c.id !== id) }));
  const removeTranscript = (id: string): void =>
    setSelections(s => ({ ...s, transcripts: s.transcripts.filter(t => t.id !== id) }));
  const removeRecording = (id: string): void =>
    setSelections(s => ({ ...s, recordings: s.recordings.filter(r => r.id !== id) }));

  const hasPills = useMemo(
    () =>
      attachments.length > 0 ||
      selections.channels.length > 0 ||
      selections.tickets.length > 0 ||
      selections.canvases.length > 0 ||
      selections.transcripts.length > 0 ||
      selections.recordings.length > 0 ||
      collections.length > 0 ||
      fileScopes.length > 0,
    [attachments, selections, collections, fileScopes],
  );

  const canSend = value.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className='relative'>
      {/* "/" context picker overlay */}
      {showContextModal && (
        <>
          <button
            type='button'
            className='fixed inset-0 z-10 cursor-default border-none bg-transparent p-0'
            onClick={closeContextModal}
            onKeyDown={e => {
              if (e.key === 'Escape') closeContextModal();
            }}
            aria-label='Close context modal'
            data-track-category='XyneAI'
            data-track-name='CLOSE_CONTEXT_MODAL_BACKDROP'
          />
          <div className='absolute bottom-full left-0 right-0 z-20 px-2 pb-2'>
            <ContextPickerPanel
              onClose={closeContextModal}
              onConfirm={setSelections}
              initialSelections={selections}
            />
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type='file'
        multiple
        onChange={handleFileInputChange}
        className='hidden'
        aria-label='Upload files'
      />
      <div
        className={isVoiceRecording ? 'xyne-voice-border-wrap' : undefined}
        style={isVoiceRecording ? { borderRadius: '1.6rem' } : undefined}
      >
        <div
          className={cn(
            'ai-composer-wrapper group flex flex-col gap-1 rounded-3xl border border-[#c0bcb4] bg-[#f5f4f0] px-3 pb-2 pt-3 transition shadow-[0_1px_0_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.08)] focus-within:border-[#a09c94] focus-within:shadow-[0_1px_0_rgba(0,0,0,0.1),0_12px_30px_-12px_rgba(0,0,0,0.12)]',
          )}
        >
          {hasPills && (
            <div
              className='flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-1'
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' }}
            >
              {selections.channels.map(channel => (
                <ContextPill
                  key={`ch-${channel.id}`}
                  icon={
                    channel.isPrivate ? (
                      <Lock className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                    ) : (
                      <Hash className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                    )
                  }
                  label={channel.name}
                  onRemove={() => removeChannel(channel.id)}
                />
              ))}
              {selections.tickets.map(ticket => (
                <ContextPill
                  key={`tk-${ticket.id}`}
                  icon={
                    <Ticket className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                  }
                  label={ticket.xyneId ? ticket.xyneId : ticket.title}
                  onRemove={() => removeTicket(ticket.id)}
                />
              ))}
              {selections.canvases.map(canvas => (
                <ContextPill
                  key={`cv-${canvas.id}`}
                  icon={
                    <FileText className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                  }
                  label={canvas.title}
                  onRemove={() => removeCanvas(canvas.id)}
                />
              ))}
              {selections.transcripts.map(transcript => (
                <ContextPill
                  key={`ts-${transcript.id}`}
                  icon={
                    <Phone className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                  }
                  label={transcript.title}
                  onRemove={() => removeTranscript(transcript.id)}
                />
              ))}
              {selections.recordings.map(recording => (
                <ContextPill
                  key={`rc-${recording.id}`}
                  icon={<Mic className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />}
                  label={recording.title}
                  onRemove={() => removeRecording(recording.id)}
                />
              ))}
              {collections.map(collection => (
                <ContextPill
                  key={`co-${collection.id}`}
                  icon={<BookOpen className='h-3.5 w-3.5 shrink-0 text-[#7C3AED]' aria-hidden />}
                  label={collection.name}
                  accent
                  onRemove={() => setCollections(prev => prev.filter(c => c.id !== collection.id))}
                />
              ))}
              {fileScopes.map(fs => (
                <ContextPill
                  key={`fs-${fs.id}`}
                  icon={<FileText className='h-3.5 w-3.5 shrink-0 text-[#7C3AED]' aria-hidden />}
                  label={fs.name}
                  accent
                  onRemove={() => setFileScopes(prev => prev.filter(f => f.id !== fs.id))}
                />
              ))}
              {attachments.map(attachment => (
                <ContextPill
                  key={attachment.id}
                  icon={
                    <FileText className='h-3.5 w-3.5 shrink-0 text-muted-foreground' aria-hidden />
                  }
                  label={attachment.name}
                  onRemove={() => handleRemoveAttachment(attachment.id)}
                />
              ))}
            </div>
          )}

          <div className='relative'>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              rows={1}
              className={cn(
                'block w-full min-h-[60px] resize-none bg-transparent px-2 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80 focus:outline-none',
                isVoiceRecording && !value && 'invisible',
              )}
              data-track-category='XyneAI'
              data-track-name='ComposerInput'
            />
            {isVoiceRecording && !value && (
              <div className='pointer-events-none absolute inset-0 flex select-none items-center gap-3 px-2 py-1'>
                <div className='flex items-end gap-[3px]' style={{ height: 18 }}>
                  {([0, 120, 60, 180, 90] as const).map((delay, i) => (
                    <div
                      key={i}
                      className='voice-wave-bar'
                      style={{ height: [10, 18, 14, 18, 10][i], animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
                <span className='text-[13px] text-muted-foreground'>Listening...</span>
              </div>
            )}
          </div>

          <div className='flex items-center justify-between gap-2'>
            {/* Left cluster: attach + all context / mode buttons. Kept on one row
              (no wrap) so the toolbar never grows vertically; the fixed button
              set fits within the composer width. Not scroll-clipped, so the
              collection / research dropdowns can overflow upward freely. */}
            <div className='flex flex-nowrap items-center gap-0.5'>
              <ToolbarButton
                icon={<Paperclip className='h-4 w-4' aria-hidden strokeWidth={1.75} />}
                label='Attach'
                onClick={handleAttachClick}
                trackName='ATTACH_FILE'
              />
              <ToolbarButton
                icon={<span className='text-[15px] font-semibold leading-none'>/</span>}
                label='Add context'
                onClick={() => setShowContextModal(v => !v)}
                active={showContextModal}
                trackName='OPEN_CONTEXT_MODAL'
              />
              <ComposerCollectionPicker
                collections={collections}
                fileScopes={fileScopes}
                onCollectionsChange={setCollections}
                onFileScopesChange={setFileScopes}
              />
              <div className='mx-0.5 h-4 w-px bg-border' />

              <ToolbarButton
                icon={<Globe className='h-4 w-4' aria-hidden strokeWidth={1.75} />}
                label={
                  webSearchAccessible
                    ? webSearchEnabled
                      ? 'Web search enabled'
                      : 'Enable web search'
                    : "You don't have access to web search."
                }
                onClick={() => {
                  if (webSearchAccessible) setWebSearchEnabled(v => !v);
                }}
                active={webSearchEnabled}
                activeClass='bg-secondary text-status-success'
                disabled={!webSearchAccessible}
                trackName='TOGGLE_WEB_SEARCH'
              />
              <ToolbarButton
                icon={<Microscope className='h-4 w-4' aria-hidden strokeWidth={1.75} />}
                label={
                  deepResearchAccessible
                    ? deepResearchEnabled
                      ? 'Deep research enabled'
                      : 'Enable deep research'
                    : "You don't have access to deep research."
                }
                onClick={() => {
                  if (deepResearchAccessible) setDeepResearchEnabled(v => !v);
                }}
                active={deepResearchEnabled}
                activeClass='bg-secondary text-status-pending'
                disabled={!deepResearchAccessible}
                trackName='TOGGLE_DEEP_RESEARCH'
              />
              {/* Provider fast mode — same credentials, faster serving via the
                  agent's fast-mode setup (Anthropic fast tier / fast profile,
                  configured in the claw agent's Model & provider tab). Only
                  rendered for agents that actually have it configured. */}
              {fastModeConfigured && (
                <ToolbarButton
                  icon={<Zap className='h-4 w-4' aria-hidden strokeWidth={1.75} />}
                  label={fastModeEnabled ? 'Fast mode enabled' : 'Enable fast mode'}
                  onClick={() => setFastModeEnabled(v => !v)}
                  active={fastModeEnabled}
                  activeClass='bg-secondary text-status-pending'
                  trackName='TOGGLE_FAST_MODE'
                />
              )}
              <ToolbarButton
                icon={<FileIcon className='h-4 w-4' aria-hidden strokeWidth={1.75} />}
                label={createCanvasEnabled ? 'Create canvas enabled' : 'Create canvas'}
                onClick={() => setCreateCanvasEnabled(v => !v)}
                active={createCanvasEnabled}
                activeClass='bg-secondary text-primary'
                trackName='TOGGLE_CREATE_CANVAS'
              />
              {/* Locked indicator, not a toggle — only rendered when the
                  selected agent is configured as an "Instant Agent"
                  (agent.config.instantAgent, see xyne-claw-auth's
                  AgentDetailLeftColumn.tsx). Every request to such an
                  agent always runs instant (enforced server-side in
                  agent-chat.ts/run-stream.ts regardless of what this
                  composer sends), so there's nothing to toggle — other
                  agents show no instant affordance at all. */}
              {instant && (
                <div
                  title='This agent always answers instantly from the Knowledge Base'
                  aria-label='Instant agent'
                  className='inline-flex h-8 shrink-0 cursor-default items-center justify-center gap-1 rounded-full bg-secondary px-2.5 text-status-pending'
                >
                  <Zap className='h-4 w-4' aria-hidden strokeWidth={1.75} />
                  <span className='text-xs font-medium'>Instant</span>
                </div>
              )}
            </div>

            <div className='flex shrink-0 items-center gap-1.5'>
              <ModelThinkingSelector
                models={agentModelsData?.models ?? []}
                defaultModel={agentModelsData?.defaultModel ?? null}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                thinkingLevel={thinkingLevel}
                onSelectThinking={setThinkingLevel}
                disabled={pending}
              />
              {showAgentSelector && (
                <AIAgentSelector
                  disabled={pending}
                  onAgentChange={slug => onAgentChange?.(slug, buildContext())}
                />
              )}
              <ComposerVoiceButton
                onTranscript={handleTranscript}
                onStateChange={({ isRecording }) => setIsVoiceRecording(isRecording)}
                disabled={pending}
              />

              {pending ? (
                <button
                  type='button'
                  onClick={onStop}
                  aria-label='Stop generating'
                  title='Stop'
                  className='inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90'
                  data-track-category='XyneAI'
                  data-track-name='STOP_GENERATION'
                >
                  <Square className='h-2.5 w-2.5 fill-current' aria-hidden strokeWidth={0} />
                </button>
              ) : (
                <button
                  type='submit'
                  disabled={!canSend}
                  aria-label='Send'
                  title='Send'
                  className={cn(
                    'ai-send-btn inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e8e4dd] text-foreground transition enabled:hover:bg-[#ddd9d2] disabled:cursor-not-allowed disabled:bg-[#e8e4dd]/50 disabled:text-muted-foreground',
                  )}
                >
                  <ArrowUp className='h-4 w-4' aria-hidden strokeWidth={2.25} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {hideDisclaimer ? null : (
        <p className='mt-2 text-center text-[11px] text-muted-foreground/80'>
          Xyne can make mistakes. Verify important details.
        </p>
      )}
    </form>
  );
});
