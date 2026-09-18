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
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  MousePointerClick,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { fetchFile } from '../../../../services/clients/fileFetchService';
import type { ConversationArtifact } from '../../../../services/XyneAI/XyneAIArtifactsService';
import {
  applyManualEdits,
  designVersions,
  htmlFromMessage,
  normalizeDesignNodeSelection,
  withDesignInspector,
  DESIGN_EDIT_EVENT,
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
import { designSelectionPayload, useDesignStudio } from './designStudioContext';

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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { html: rawHtml, loading, error } = useDesignSourceHtml(active?.source ?? null);

  const applied = useMemo(
    () => (rawHtml === null ? null : applyManualEdits(rawHtml, manualEdits)),
    [rawHtml, manualEdits],
  );
  const editedHtml = applied?.html ?? null;

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
      };
      if (!data || typeof data.type !== 'string') return;
      if (data.type === DESIGN_VERIFY_RESULT_EVENT) {
        setSelectionStale(data.ok === false);
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
  const onFrameLoad = useCallback((): void => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const y = scrollRef.current;
    if (y > 0) frame.postMessage({ type: DESIGN_SCROLL_RESTORE_EVENT, y }, '*');
    const current = selectionRef.current;
    if (current) frame.postMessage({ type: DESIGN_VERIFY_EVENT, selector: current.selector }, '*');
  }, []);

  const setPendingEdit = studio?.setPendingEdit;
  useEffect(() => {
    if (!setPendingEdit) return;
    const hasEdits = !!editedHtml && manualEdits.length > 0;
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
        setSelection(null);
      },
    });
    return () => setPendingEdit(null);
  }, [setPendingEdit, editedHtml, manualEdits, selection, scope]);

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

  const presetWidth = DEVICE_PRESETS.find(p => p.id === devicePreset)?.width ?? null;
  const frameStyle: CSSProperties = presetWidth
    ? { width: `${presetWidth}px`, maxWidth: '100%', height: '100%' }
    : { width: '100%', height: '100%' };

  const heading = title ?? artifact?.title ?? 'Design preview';

  return (
    <div className='flex h-full min-h-0 w-full flex-col bg-background'>
      <div className='flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5'>
        <span className='mr-auto flex min-w-0 flex-col leading-tight'>
          <span className='truncate text-xs text-muted-foreground' title={heading}>
            {heading}
          </span>
          <span className='truncate text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70'>
            {streaming ? 'Updating preview' : active ? 'Live design' : 'Preview'}
          </span>
        </span>
        <button
          type='button'
          onClick={() => setInspecting((v): boolean => !v)}
          aria-pressed={inspecting}
          title='Click an element to select it, double-click text to edit it'
          className={cn(
            'flex h-7 items-center gap-1 rounded px-2 text-xs',
            inspecting
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
          data-track-category='AskAI'
          data-track-name='design-inspect-toggle'
        >
          <MousePointerClick className='h-3.5 w-3.5' />
          Edit
        </button>
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
        <button
          type='button'
          onClick={() => setShowCode((v): boolean => !v)}
          aria-pressed={showCode}
          aria-label='View code'
          title='View code'
          className={cn(
            'grid h-7 w-7 place-items-center rounded',
            showCode
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
          data-track-category='AskAI'
          data-track-name='design-view-code'
        >
          <Code2 className='h-4 w-4' />
        </button>
        <button
          type='button'
          onClick={download}
          disabled={!editedHtml}
          aria-label='Download HTML'
          title='Download HTML'
          className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40'
          data-track-category='AskAI'
          data-track-name='design-export'
        >
          <Download className='h-4 w-4' />
        </button>
      </div>

      <div className='relative min-h-0 flex-1 overflow-hidden bg-muted/40'>
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
          <pre className='h-full overflow-auto bg-background p-3 text-[11px] leading-relaxed text-foreground'>
            <code>{editedHtml}</code>
          </pre>
        ) : (
          <div className='flex h-full w-full justify-center overflow-auto'>
            <iframe
              ref={iframeRef}
              title={heading}
              srcDoc={srcDoc}
              onLoad={onFrameLoad}
              sandbox='allow-scripts'
              referrerPolicy='no-referrer'
              style={frameStyle}
              className='border-0 bg-white'
            />
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
