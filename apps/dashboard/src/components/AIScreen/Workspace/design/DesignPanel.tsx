import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../../utils/classNames';
import { fetchFile } from '../../../../services/clients/fileFetchService';
import type { ConversationArtifact } from '../../../../services/XyneAI/XyneAIArtifactsService';
import {
  applyManualEdits,
  designVersions,
  htmlFromMessage,
  normalizeDesignNodeSelection,
  withDesignInspector,
  withSliderOverrides,
  DESIGN_EDIT_EVENT,
  DESIGN_SET_TOKEN_EVENT,
  DESIGN_TOKENS_EVENT,
  DESIGN_INSPECTOR_EVENT,
  DESIGN_INSPECTOR_MODE_EVENT,
  DESIGN_SCROLL_EVENT,
  DESIGN_SCROLL_RESTORE_EVENT,
  DESIGN_VERIFY_EVENT,
  DESIGN_VERIFY_RESULT_EVENT,
  type DesignEditScope,
  type DesignManualEdit,
  type DesignNodeSelection,
  type DesignPreviewSource,
  type DesignVersion,
} from './designDocument';
import {
  buildTokenControls,
  changedOverrides,
  formatControlValue,
  isColorControl,
  type TokenControl,
} from './tokenSliders';
import { designSelectionPayload, useDesignStudio } from './designStudioContext';
import { DesignShareButton } from './DesignShareButton';
import { UnmountWhenCovered } from '../../../../hooks/usePageCoverage';
import {
  CANVAS_BACKGROUNDS,
  CANVAS_BACKGROUND_LABELS,
  canvasBackgroundStyle,
  openSandboxedPreview,
  type CanvasBackground,
} from './designPreviewChrome';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';

const DEVICE_PRESETS = [
  { id: 'desktop', label: 'Desktop', width: null },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', width: 390 },
  { id: 'fit', label: 'Fit', width: null },
] as const;

type DevicePresetId = (typeof DEVICE_PRESETS)[number]['id'];

const EDIT_SCOPES: readonly DesignEditScope[] = ['element', 'component', 'design-system'];

export interface DesignPanelProps {
  artifact?: ConversationArtifact | undefined;
  title?: string | undefined;
}

function attachmentDownloadUrl(refId: string): string {
  return `/xyne-ai/v2/attachments/${encodeURIComponent(refId)}/download`;
}

function useDesignSourceHtml(source: DesignPreviewSource | null): {
  html: string | null;
  loading: boolean;
  error: string | null;
} {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inlineHtml = source?.kind === 'inline' ? source.html : null;
  const attachmentId = source?.kind === 'attachment' ? source.attachmentId : null;
  const fileName = source?.fileName ?? 'xyne-design.html';

  useEffect(() => {
    if (inlineHtml !== null) {
      setHtml(inlineHtml);
      setLoading(false);
      setError(null);
      return;
    }
    if (!attachmentId) {
      setHtml(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchFile(attachmentDownloadUrl(attachmentId), fileName, 'text/html')
      .then((file): Promise<string> => file.text())
      .then(text => {
        if (!cancelled) {
          setHtml(text);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
          setError('Unable to load this design.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inlineHtml, attachmentId, fileName]);

  return { html, loading, error };
}

const DRAFT_DEBOUNCE_MS = 250;

export function DesignPanel({ artifact, title }: DesignPanelProps): ReactElement {
  const studio = useDesignStudio();
  const studioMessages = studio?.messages;
  const messages = useMemo(() => studioMessages ?? [], [studioMessages]);

  const versions = useMemo<DesignVersion[]>(() => {
    const list = designVersions(messages);
    const latestRef = artifact?.latestVersionRef ?? artifact?.openRef.refId ?? null;
    const hasLatest =
      latestRef !== null &&
      list.some(v => v.source.kind === 'attachment' && v.source.attachmentId === latestRef);
    if (latestRef && !hasLatest && artifact) {
      list.push({
        source: { kind: 'attachment', attachmentId: latestRef, fileName: `${artifact.title}.html` },
        messageId: artifact.messageId ?? artifact.id,
        messageIndex: list.length,
        createdAt: artifact.updatedAt,
        label: `v${list.length + 1}`,
      });
    }
    return list;
  }, [messages, artifact]);

  const streaming = useMemo(
    () => [...messages].reverse().find(m => m.type === 'bot')?.isStreaming === true,
    [messages],
  );

  const liveHtml = useMemo(() => {
    const last = [...messages].reverse().find(m => m.type === 'bot');
    if (!last) return null;
    return htmlFromMessage(last);
  }, [messages]);

  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  useEffect(() => {
    if (liveHtml === null) {
      setDraftHtml(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setDraftHtml(liveHtml), DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [liveHtml]);

  const entries = useMemo<{ label: string; source: DesignPreviewSource }[]>(() => {
    const list = versions.map(v => ({ label: v.label, source: v.source }));
    if (draftHtml) {
      list.push({
        label: streaming ? 'Draft' : `v${list.length + 1}`,
        source: { kind: 'inline', html: draftHtml, fileName: 'xyne-design.html' },
      });
    }
    return list;
  }, [versions, draftHtml]);

  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const activeIndex =
    entries.length === 0
      ? -1
      : pinnedIndex !== null && pinnedIndex < entries.length
        ? pinnedIndex
        : entries.length - 1;
  const active = activeIndex >= 0 ? (entries[activeIndex] ?? null) : null;

  const [manualEdits, setManualEdits] = useState<DesignManualEdit[]>([]);
  const [selection, setSelection] = useState<DesignNodeSelection | null>(null);
  const [selectionStale, setSelectionStale] = useState(false);
  const [scope, setScope] = useState<DesignEditScope>('element');
  const [inspecting, setInspecting] = useState(false);
  const [devicePreset, setDevicePreset] = useState<DevicePresetId>('desktop');
  const [showCode, setShowCode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canvasBackground, setCanvasBackground] = useState<CanvasBackground>('light');
  const [showTokens, setShowTokens] = useState(false);
  // The `:root` custom properties this document declares, as the frame reports
  // them. Controls are built from these and nothing else, so a slider can never
  // address a variable the design does not have (XYNE-66834).
  const [declaredTokens, setDeclaredTokens] = useState<Record<string, string>>({});
  /** Dragged but not saved. Applied live over postMessage, never in the HTML. */
  const [tokenOverrides, setTokenOverrides] = useState<Record<string, string>>({});
  /** Committed by "Save to design", folded into the document below. */
  const [savedTokenOverrides, setSavedTokenOverrides] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const exitOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || menuOpenRef.current) return;
      event.stopImmediatePropagation();
      setFullscreen(false);
    };
    window.addEventListener('keydown', exitOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', exitOnEscape, { capture: true });
  }, [fullscreen]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const { html: rawHtml, loading, error } = useDesignSourceHtml(active?.source ?? null);

  const applied = useMemo(
    () => (rawHtml === null ? null : applyManualEdits(rawHtml, manualEdits)),
    [rawHtml, manualEdits],
  );
  // Saved slider overrides ride into the document; live ones do not. Dragging
  // must not rebuild srcDoc, because that reloads the frame on every tick.
  const editedHtml = useMemo(
    () => (applied === null ? null : withSliderOverrides(applied.html, savedTokenOverrides)),
    [applied, savedTokenOverrides],
  );

  useEffect(() => {
    if (!applied) return;
    const changed = applied.edits.some((edit, index) => edit.stale !== manualEdits[index]?.stale);
    if (changed) setManualEdits(applied.edits);
  }, [applied, manualEdits]);

  const srcDoc = useMemo(
    () => (editedHtml === null ? null : withDesignInspector(editedHtml)),
    [editedHtml],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        y?: number;
        ok?: boolean;
        enabled?: boolean;
        edit?: unknown;
        selection?: unknown;
        declared?: unknown;
      };
      if (!data || typeof data.type !== 'string') return;
      if (data.type === DESIGN_VERIFY_RESULT_EVENT) {
        setSelectionStale(data.ok === false);
        return;
      }
      if (data.type === DESIGN_TOKENS_EVENT) {
        const declared = data.declared;
        if (declared && typeof declared === 'object') {
          const entries = Object.entries(declared as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          );
          setDeclaredTokens(Object.fromEntries(entries));
        }
        return;
      }
      if (data.type === DESIGN_SCROLL_EVENT) {
        if (typeof data.y === 'number') scrollRef.current = data.y;
        return;
      }
      if (data.type === DESIGN_INSPECTOR_MODE_EVENT && data.enabled === false) {
        setInspecting(false);
        return;
      }
      if (data.type === DESIGN_EDIT_EVENT) {
        const edit = data.edit as Partial<DesignManualEdit> | null | undefined;
        if (
          edit &&
          typeof edit.selector === 'string' &&
          typeof edit.oldText === 'string' &&
          typeof edit.newText === 'string'
        ) {
          const next: DesignManualEdit = {
            selector: edit.selector,
            oldText: edit.oldText,
            newText: edit.newText,
            stale: false,
          };
          setManualEdits(current => [...current, next]);
        }
        return;
      }
      if (data.type !== DESIGN_INSPECTOR_EVENT) return;
      const candidate = normalizeDesignNodeSelection(data.selection);
      if (candidate) {
        setSelection(candidate);
        setSelectionStale(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: DESIGN_INSPECTOR_MODE_EVENT, enabled: inspecting },
      '*',
    );
  }, [inspecting, srcDoc]);

  const scrollRef = useRef(0);
  const selectionRef = useRef<DesignNodeSelection | null>(null);
  selectionRef.current = selection;
  const inspectingRef = useRef(inspecting);
  inspectingRef.current = inspecting;
  const onFrameLoad = useCallback((): void => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const y = scrollRef.current;
    if (y > 0) frame.postMessage({ type: DESIGN_SCROLL_RESTORE_EVENT, y }, '*');
    const current = selectionRef.current;
    if (current) frame.postMessage({ type: DESIGN_VERIFY_EVENT, selector: current.selector }, '*');
    // A frame loaded again (back from full-page search) starts with inspecting off.
    if (inspectingRef.current) {
      frame.postMessage({ type: DESIGN_INSPECTOR_MODE_EVENT, enabled: true }, '*');
    }
  }, []);

  const setPendingEdit = studio?.setPendingEdit;
  useEffect(() => {
    if (!setPendingEdit) return;
    // Saved slider overrides count as edits. Without them in this condition,
    // "Save to design" would show in the preview and then be dropped on the next
    // turn — and the pending edit is the only thing that carries a hand edit
    // forward, so the save would have quietly meant nothing.
    const hasEdits =
      !!editedHtml && (manualEdits.length > 0 || Object.keys(savedTokenOverrides).length > 0);
    if (!hasEdits && !selection) {
      setPendingEdit(null);
      return;
    }
    setPendingEdit({
      ...(hasEdits && editedHtml ? { html: editedHtml } : {}),
      fileName: 'xyne-design.html',
      ...(selection ? { selection: designSelectionPayload(selection, scope) } : {}),
      clear: () => {
        setManualEdits([]);
        setSavedTokenOverrides({});
        setSelection(null);
      },
    });
    return () => setPendingEdit(null);
  }, [setPendingEdit, editedHtml, manualEdits, savedTokenOverrides, selection, scope]);

  // A drag belongs to the document it was made against. Switching version or
  // reloading re-mounts the frame with none of the inline overrides on it, so
  // keeping them would leave a slider showing a value the preview is not using.
  useEffect(() => {
    setTokenOverrides({});
  }, [activeIndex, reloadKey]);

  const tokenControls = useMemo(() => buildTokenControls(declaredTokens), [declaredTokens]);
  const movedTokens = useMemo(
    () => changedOverrides(tokenControls, tokenOverrides),
    [tokenControls, tokenOverrides],
  );

  /** Straight to the frame. No state round-trip, no srcDoc rebuild, no reload —
   *  this is what makes dragging feel like dragging. */
  const postTokenVars = useCallback((vars: Record<string, string | null>): void => {
    iframeRef.current?.contentWindow?.postMessage({ type: DESIGN_SET_TOKEN_EVENT, vars }, '*');
  }, []);

  const setTokenValue = useCallback(
    (control: TokenControl, next: number | string): void => {
      const value = formatControlValue(control, next);
      setTokenOverrides(current => ({ ...current, [control.name]: value }));
      postTokenVars({ [control.name]: value });
    },
    [postTokenVars],
  );

  const resetTokens = useCallback((): void => {
    // Removing the inline property rather than writing the old value back: the
    // document's own rule is still there underneath, so this returns the design
    // to exactly what it declared instead of pinning a copy of it.
    const cleared: Record<string, string | null> = {};
    for (const control of tokenControls) cleared[control.name] = null;
    postTokenVars(cleared);
    setTokenOverrides({});
  }, [tokenControls, postTokenVars]);

  const saveTokensToDesign = useCallback((): void => {
    if (Object.keys(movedTokens).length === 0) return;
    // Folded into the document, which rebuilds srcDoc and reloads the frame
    // once. The frame then re-reports its tokens, so these values become the
    // new originals and Reset means "back to the saved design".
    setSavedTokenOverrides(current => ({ ...current, ...movedTokens }));
    setTokenOverrides({});
    toast.success('Saved to this design');
  }, [movedTokens]);

  const undoEdit = useCallback((index: number): void => {
    setManualEdits(current => current.filter((_, i) => i !== index));
  }, []);

  const download = useCallback((): void => {
    if (!editedHtml) return;
    const url = URL.createObjectURL(new Blob([editedHtml], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = active?.source.fileName ?? 'xyne-design.html';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [editedHtml, active]);

  const openInNewTab = useCallback((): void => {
    if (!editedHtml) return;
    if (!openSandboxedPreview(editedHtml, title ?? artifact?.title ?? 'Design preview')) {
      toast.error('Your browser blocked the new tab');
    }
  }, [editedHtml, title, artifact]);

  const copySource = useCallback((): void => {
    if (!editedHtml) return;
    void navigator.clipboard.writeText(editedHtml).then(
      () => setCopied(true),
      () => toast.error('Could not copy the source'),
    );
  }, [editedHtml]);

  const presetWidth = DEVICE_PRESETS.find(p => p.id === devicePreset)?.width ?? null;
  const frameStyle: CSSProperties = presetWidth
    ? { width: `${presetWidth}px`, maxWidth: '100%', height: '100%' }
    : { width: '100%', height: '100%' };

  const heading = title ?? artifact?.title ?? 'Design preview';
  const activeAttachmentId =
    active?.source.kind === 'attachment' ? active.source.attachmentId : null;

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-col bg-background',
        fullscreen ? 'fixed inset-0 z-[70] h-dvh' : 'h-full',
      )}
      data-testid='design-panel'
      data-fullscreen={fullscreen || undefined}
    >
      <div className='flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5'>
        <span className='mr-auto flex min-w-0 flex-col leading-tight'>
          <span className='truncate text-xs text-muted-foreground' title={heading}>
            {heading}
          </span>
          <span className='truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70'>
            {streaming ? 'Updating preview' : active ? 'Live design' : 'Preview'}
          </span>
        </span>
        <div className='flex items-center rounded border border-border p-0.5'>
          {DEVICE_PRESETS.map(preset => (
            <button
              key={preset.id}
              type='button'
              onClick={() => setDevicePreset(preset.id)}
              aria-pressed={devicePreset === preset.id}
              className={cn(
                'h-6 rounded px-1.5 text-[11px]',
                devicePreset === preset.id
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-track-category='AskAI'
              data-track-name='design-device-preset'
            >
              {preset.label}
            </button>
          ))}
        </div>
        {entries.length > 1 && (
          <div className='flex items-center gap-0.5 rounded border border-border px-1'>
            <button
              type='button'
              aria-label='Previous version'
              data-track-category='AskAI'
              data-track-name='design-version-prev'
              disabled={activeIndex <= 0}
              onClick={() => setPinnedIndex(Math.max(0, activeIndex - 1))}
              className='grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40'
            >
              <ChevronLeft className='h-3.5 w-3.5' />
            </button>
            <span className='min-w-[52px] text-center text-[11px] text-muted-foreground'>
              {active?.label ?? '—'} / {entries.length}
            </span>
            <button
              type='button'
              aria-label='Next version'
              data-track-category='AskAI'
              data-track-name='design-version-next'
              disabled={activeIndex >= entries.length - 1}
              onClick={() =>
                setPinnedIndex(activeIndex + 1 >= entries.length - 1 ? null : activeIndex + 1)
              }
              className='grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40'
            >
              <ChevronRight className='h-3.5 w-3.5' />
            </button>
          </div>
        )}
        <DesignShareButton
          conversationId={artifact?.conversationId ?? null}
          attachmentId={activeAttachmentId}
          title={heading}
          hasUnsavedEdits={manualEdits.length > 0}
        />
        {fullscreen && (
          <button
            type='button'
            onClick={() => setFullscreen(false)}
            aria-label='Exit fullscreen'
            title='Exit fullscreen (Esc)'
            className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            data-track-category='AskAI'
            data-track-name='design-fullscreen-exit'
          >
            <Minimize2 className='h-4 w-4' />
          </button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='More design options'
              title='More options'
              className='relative grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground'
              data-track-category='AskAI'
              data-track-name='design-more-menu'
              data-testid='design-more-menu'
            >
              <MoreHorizontal className='h-4 w-4' />
              {(inspecting || showCode) && (
                <span className='absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary' />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='z-[80] w-56'>
            <DropdownMenuItem
              onSelect={() => setInspecting(value => !value)}
              data-track-category='AskAI'
              data-track-name='design-inspect-toggle'
            >
              <MousePointerClick className='h-4 w-4' />
              <span className='flex-1'>Edit design</span>
              {inspecting && <Check className='h-4 w-4' />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setShowTokens(value => !value)}
              data-track-category='AskAI'
              data-track-name='design-token-sliders-toggle'
            >
              <SlidersHorizontal className='h-4 w-4' />
              <span className='flex-1'>Adjust tokens</span>
              {showTokens && <Check className='h-4 w-4' />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setShowCode(value => !value)}
              data-track-category='AskAI'
              data-track-name='design-view-code'
            >
              <Code2 className='h-4 w-4' />
              <span className='flex-1'>View code</span>
              {showCode && <Check className='h-4 w-4' />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className='pl-8 text-xs font-normal text-muted-foreground'>
              Canvas background
            </DropdownMenuLabel>
            {CANVAS_BACKGROUNDS.map(background => (
              <DropdownMenuItem
                key={background}
                inset
                onSelect={() => setCanvasBackground(background)}
                data-track-category='AskAI'
                data-track-name='design-canvas-background'
              >
                <span className='flex-1'>{CANVAS_BACKGROUND_LABELS[background]}</span>
                {canvasBackground === background && <Check className='h-4 w-4' />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!srcDoc}
              onSelect={() => setReloadKey(key => key + 1)}
              data-track-category='AskAI'
              data-track-name='design-refresh'
            >
              <RefreshCw className='h-4 w-4' />
              Refresh preview
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!editedHtml}
              onSelect={openInNewTab}
              data-track-category='AskAI'
              data-track-name='design-open-new-tab'
            >
              <ExternalLink className='h-4 w-4' />
              Open in new tab
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setFullscreen(value => !value)}
              data-track-category='AskAI'
              data-track-name='design-fullscreen'
            >
              {fullscreen ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!editedHtml}
              onSelect={download}
              data-track-category='AskAI'
              data-track-name='design-export'
            >
              <Download className='h-4 w-4' />
              Download HTML
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          canvasBackground === 'light' && 'bg-muted/40',
        )}
        style={canvasBackgroundStyle(canvasBackground)}
        data-testid='design-canvas'
        data-background={canvasBackground}
      >
        {loading && !srcDoc ? (
          <div className='flex h-full items-center justify-center'>
            <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-ring' />
          </div>
        ) : error ? (
          <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
            {error}
          </div>
        ) : !srcDoc ? (
          <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
            No design to preview yet.
          </div>
        ) : showCode ? (
          <div className='relative h-full'>
            <button
              type='button'
              onClick={copySource}
              className='absolute right-3 top-3 z-10 flex h-7 items-center gap-1.5 rounded border border-border bg-background/95 px-2 text-[11px] text-foreground shadow-sm hover:bg-secondary'
              data-track-category='AskAI'
              data-track-name='design-copy-source'
            >
              {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <pre className='h-full overflow-auto bg-background p-3 pr-24 text-[11px] leading-relaxed text-foreground'>
              <code>{editedHtml}</code>
            </pre>
          </div>
        ) : (
          <div className='flex h-full w-full justify-center overflow-auto'>
            {/* Its scripts stop under full-page search, as leaving the page stopped them. */}
            <UnmountWhenCovered fallback={<div style={frameStyle} className='bg-white' />}>
              <iframe
                key={reloadKey}
                ref={iframeRef}
                title={heading}
                srcDoc={srcDoc}
                onLoad={onFrameLoad}
                sandbox='allow-scripts'
                referrerPolicy='no-referrer'
                style={frameStyle}
                className='border-0 bg-white'
              />
            </UnmountWhenCovered>
          </div>
        )}
        {showTokens && srcDoc && (
          <div className='absolute right-3 top-3 z-10 w-64 overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur'>
            <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
              <SlidersHorizontal className='h-3.5 w-3.5 text-muted-foreground' />
              <span className='flex-1 text-xs font-medium text-foreground'>Tokens</span>
              <button
                type='button'
                onClick={() => setShowTokens(false)}
                className='rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground'
                aria-label='Close token controls'
                title='Close'
                data-track-category='AskAI'
                data-track-name='design-token-sliders-close'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            </div>
            {tokenControls.length === 0 ? (
              // Not a failure, and worth saying why rather than showing an
              // empty box: a design that hardcodes its values has nothing to
              // drag, and the fix is a word to the model, not a retry here.
              <p className='px-3 py-3 text-[11px] leading-relaxed text-muted-foreground'>
                This design declares no adjustable tokens. Ask for its colours, radii and spacing as
                CSS variables under <code className='font-mono'>:root</code> and they will show up
                here.
              </p>
            ) : (
              <>
                <div className='max-h-[min(22rem,50vh)] overflow-y-auto px-3 py-2'>
                  {tokenControls.map(control => {
                    const current = tokenOverrides[control.name];
                    return (
                      <div key={control.name} className='py-1.5'>
                        <div className='flex items-baseline gap-2'>
                          <span
                            className='min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground'
                            title={control.name}
                          >
                            {control.label}
                          </span>
                          <span className='font-mono text-[11px] text-foreground'>
                            {current ?? control.originalValue}
                          </span>
                        </div>
                        {isColorControl(control) ? (
                          <input
                            type='color'
                            value={current ?? control.value}
                            onChange={event => setTokenValue(control, event.target.value)}
                            className='mt-1 h-6 w-full cursor-pointer rounded border border-border bg-transparent p-0.5'
                            aria-label={control.label}
                            data-track-category='AskAI'
                            data-track-name='design-token-slider-color'
                          />
                        ) : (
                          <input
                            type='range'
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={
                              current === undefined ? control.value : Number.parseFloat(current)
                            }
                            onChange={event =>
                              setTokenValue(control, Number.parseFloat(event.target.value))
                            }
                            className='mt-1 w-full accent-primary'
                            aria-label={control.label}
                            data-track-category='AskAI'
                            data-track-name='design-token-slider-range'
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className='flex items-center gap-1.5 border-t border-border px-3 py-2'>
                  <button
                    type='button'
                    onClick={resetTokens}
                    disabled={Object.keys(movedTokens).length === 0}
                    className='rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
                    data-track-category='AskAI'
                    data-track-name='design-token-sliders-reset'
                  >
                    Reset
                  </button>
                  <button
                    type='button'
                    onClick={saveTokensToDesign}
                    disabled={Object.keys(movedTokens).length === 0}
                    className='rounded bg-action-primary px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
                    data-track-category='AskAI'
                    data-track-name='design-token-sliders-save-design'
                  >
                    Save to design
                  </button>
                  <button
                    type='button'
                    disabled
                    title='Needs the design systems page (XYNE-66820) to reach the system from here'
                    className='ml-auto cursor-not-allowed rounded px-1.5 py-1 text-[11px] text-muted-foreground opacity-50'
                  >
                    Save to system
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {selection && selectionStale && (
          <div className='pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-amber-500/40 bg-background/95 px-3 py-1.5 text-[11px] text-amber-600 shadow-md backdrop-blur dark:text-amber-400'>
            The design changed — reselect to be precise
          </div>
        )}
        {inspecting && !selection && (
          <div className='pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 text-[11px] text-primary shadow-md backdrop-blur'>
            Click an element to select it
          </div>
        )}
        {streaming && (
          <div className='absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-md backdrop-blur'>
            <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-primary' />
            Agent is updating the design
          </div>
        )}
      </div>

      {selection && (
        <div className='flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5 text-[11px]'>
          <span
            className='min-w-0 flex-1 truncate text-muted-foreground'
            title={selection.selector}
          >
            {selection.label}
          </span>
          {EDIT_SCOPES.map(value => (
            <button
              key={value}
              type='button'
              onClick={() => setScope(value)}
              data-track-category='AskAI'
              data-track-name='design-scope-select'
              aria-pressed={scope === value}
              className={cn(
                'h-6 rounded border px-1.5',
                scope === value
                  ? 'border-primary text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {value}
            </button>
          ))}
          <button
            type='button'
            onClick={() => setSelection(null)}
            data-track-category='AskAI'
            data-track-name='design-selection-clear'
            className='h-6 rounded px-1.5 text-muted-foreground hover:text-foreground'
          >
            Clear
          </button>
        </div>
      )}

      {manualEdits.length > 0 && (
        <div className='max-h-32 overflow-auto border-t border-border px-2 py-1.5'>
          <div className='mb-1 flex items-center gap-2'>
            <span className='text-[11px] font-medium text-foreground'>
              {manualEdits.length} manual edit{manualEdits.length === 1 ? '' : 's'}
            </span>
            <button
              type='button'
              onClick={() => setManualEdits([])}
              className='ml-auto flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground'
              data-track-category='AskAI'
              data-track-name='design-edits-reset'
            >
              <RotateCcw className='h-3 w-3' />
              Reset
            </button>
          </div>
          <ul className='space-y-0.5'>
            {manualEdits.map((edit, index) => (
              <li
                key={`${edit.selector}-${index}`}
                className='flex items-center gap-2 text-[11px] text-muted-foreground'
              >
                <span className='min-w-0 flex-1 truncate' title={edit.selector}>
                  {edit.styles
                    ? `${edit.selector} · ${Object.keys(edit.styles).join(', ')}`
                    : `${edit.selector} · "${edit.newText ?? ''}"`}
                  {edit.stale ? ' (stale)' : ''}
                </span>
                <button
                  type='button'
                  onClick={() => undoEdit(index)}
                  data-track-category='AskAI'
                  data-track-name='design-edit-undo'
                  className='h-5 rounded px-1 hover:text-foreground'
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
