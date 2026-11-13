/**
 * Build: the conversational-flow map with the selected screen's inspector beside it.
 *
 * It owns no model of its own. It holds the workflow config, reads it into
 * screens on every change, and each edit is a pure function over the config —
 * so saving goes through the host's ordinary `onSave`, and the flow still runs
 * exactly as the engine sees it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Redo2, Undo2, Workflow, X } from 'lucide-react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { cn } from '../shared/cn.js';
import { useUndoRedo } from '../../hooks/use-undo-redo.js';
import { useAutosave } from './use-autosave.js';
import {
  AGENT_STEP_TYPE,
  addCall,
  addScreen,
  ancestorsOf,
  childrenOf,
  type ConversationalFlow,
  ConversationalFlowEditError,
  duplicateScreen,
  flowRouter,
  insertScreenAbove,
  type NewScreenType,
  type Screen,
  type ScreenKind,
  readConversationalFlow,
  addInputScreen,
} from '@xyne/workflow-sdk/conversational-flow';
import { FlowMap } from './map/FlowMap.js';
import type { AddChoice } from './map/AddMenu.js';
import { Inspector } from './inspector/Inspector.js';
import { CallPanel } from './inspector/CallPanel.js';
import { Button } from './ui.js';
import { FieldOptionsScopeProvider } from '../builder/v3/field-options.js';

export interface ConversationalFlowEditorProps {
  /** The saved workflow, when there is one: agent pickers ask the server for its agents. */
  workflowId?: string | undefined;
  initialConfig: WorkflowConfig | undefined;
  onSave?: ((config: WorkflowConfig) => Promise<void>) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /**
   * Save on its own shortly after each change, as well as on the button.
   * Saving is last-write-wins, so two tabs on one workflow will overwrite each
   * other — pass false where that matters more than not losing work.
   */
  autosave?: boolean | undefined;
  /** Open the flow as raw steps, for anything the map doesn't draw. */
  onOpenSteps?: (() => void) | undefined;
  readOnly?: boolean | undefined;
}

/** Open the first two levels; fold anything deeper that has screens beneath it. */
function initialFolds(flow: ConversationalFlow | null): Set<string> {
  if (!flow) return new Set();
  const kids = childrenOf(flow);
  return new Set(flow.screens.filter((s) => s.depth >= 2 && (kids.get(s.id)?.length ?? 0) > 0).map((s) => s.id));
}

export function ConversationalFlowEditor({ workflowId, initialConfig, onSave, onDirtyChange, onOpenSteps, readOnly = false, autosave = true }: ConversationalFlowEditorProps) {
  const { state: config, setState: setConfig, undo, redo, canUndo, canRedo } = useUndoRedo(initialConfig);
  const [saved, setSaved] = useState(() => JSON.stringify(initialConfig));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A save that failed, specifically — `error` also carries refused edits.
  const [saveFailed, setSaveFailed] = useState(false);
  const flow = useMemo(() => (config ? readConversationalFlow(config) : null), [config]);
  const [folded, setFolded] = useState<Set<string>>(() => initialFolds(flow));
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number }>();

  const dirty = JSON.stringify(config) !== saved;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // A screen that no longer exists (removed, or its type changed away) drops the selection.
  const screen = flow?.screens.find((s) => s.id === selected) ?? null;
  // A lookup is selected the same way a screen is; its id is its step's.
  const lookup = useMemo(() => {
    for (const owner of flow?.screens ?? []) {
      const call = owner.calls.find((c) => c.id === selected);
      if (call) return { call, owner };
    }
    return null;
  }, [flow, selected]);

  /**
   * Apply one change to the config.
   *
   * Applied against whatever is *current* rather than against the config this
   * render closed over, so two edits in the same tick compose instead of the
   * second discarding the first. That happens whenever one action is really two
   * — working a value out and then quoting it, for instance: the quote would
   * land on a config that never had the calculation in it, and the calculation
   * would vanish with no error anywhere.
   *
   * The change still runs here first, so a refusal is reported now and returned
   * as `false`, which callers rely on. It runs a second time only if something
   * else has changed in between, which is the case the first result cannot
   * answer for.
   */
  const edit = useCallback(
    (change: (c: WorkflowConfig) => WorkflowConfig): boolean => {
      if (!config) return false;
      let next: WorkflowConfig;
      try {
        next = change(config);
      } catch (e) {
        if (!(e instanceof ConversationalFlowEditError)) throw e;
        setError(e.message);
        return false;
      }
      setConfig((prev) => (prev === undefined || prev === config ? next : change(prev)));
      setError(null);
      return true;
    },
    [config],
  );

  /** Select a screen and make sure it can be seen: unfold its ancestors, bring it into view. */
  const reveal = useCallback(
    (id: string) => {
      if (!flow) return;
      setSelected(id);
      const above = ancestorsOf(flow, id);
      setFolded((prev) => (above.some((a) => prev.has(a)) ? new Set([...prev].filter((f) => !above.includes(f))) : prev));
      setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    },
    [flow],
  );

  const newScreen = useCallback(
    (parent: string, args: { title: string; type: NewScreenType }) => {
      if (!config) return;
      try {
        const result = addScreen(config, { title: args.title, parent, type: args.type });
        setConfig(result.config);
        setError(null);
        setFolded((prev) => {
          const next = new Set(prev);
          next.delete(parent);
          return next;
        });
        setSelected(result.screenId);
        setFocus((f) => ({ id: result.screenId, n: (f?.n ?? 0) + 1 }));
      } catch (e) {
        if (!(e instanceof ConversationalFlowEditError)) throw e;
        setError(e.message);
      }
    },
    [config],
  );

  /**
   * Something new inside a screen: another screen, or something to look up
   * before it. Both land selected, so the next thing to do is say what it is.
   */
  const add = useCallback(
    (parent: string, choice: AddChoice) => {
      if (choice.kind === 'screen') {
        newScreen(parent, { title: titleFor(choice.type), type: choice.type });
        return;
      }
      if (!config) return;
      // Whatever was added lands selected, so the next thing to do is name it.
      const land = (next: WorkflowConfig, id: string) => {
        setConfig(next);
        setError(null);
        setSelected(id);
        setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
      };
      try {
        // "Above" is the one that doesn't go inside: it takes the screen's place
        // in the path, and the screen moves inside it.
        // Two presets over one node: an empty one to fill in, and the rating.
        if (choice.kind === 'input' || choice.kind === 'feedback') {
          const asking = addInputScreen(
            config,
            choice.kind === 'feedback'
              ? {
                  parent,
                  title: 'How did we do?',
                  purpose: 'feedback',
                  asks: [{ kind: 'choice', label: 'How did we do?', choices: ['1', '2', '3', '4', '5'] }],
                  next: { title: 'Thanks', type: 'end' },
                }
              : { parent, title: 'Ask for details' },
          );
          land(asking.config, asking.screenId);
          return;
        }
        if (choice.kind === 'above') {
          const { config: next, screenId } = insertScreenAbove(config, parent, { title: 'New screen' });
          land(next, screenId);
          return;
        }
        const { config: next, callId } = addCall(config, parent, {
          title: choice.title,
          request: { method: 'GET', url: choice.url, timeoutMs: 10_000, response: { type: 'json' } },
        });
        land(next, callId);
      } catch (e) {
        if (!(e instanceof ConversationalFlowEditError)) throw e;
        setError(e.message);
      }
    },
    [config, newScreen],
  );

  /** A copy of a screen, beside it or inside it — and selected, like an add. */
  const duplicate = useCallback(
    (id: string, as: 'sibling' | 'child') => {
      if (!config) return;
      try {
        const result = duplicateScreen(config, id, { as });
        setConfig(result.config);
        setError(null);
        setSelected(result.screenId);
        setFocus((f) => ({ id: result.screenId, n: (f?.n ?? 0) + 1 }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [config],
  );

  const ends = useMemo(() => flow?.screens.filter((s) => s.kind === 'end') ?? [], [flow]);
  const handoffs = useMemo(() => flow?.screens.filter((s) => s.kind === 'handoff') ?? [], [flow]);

  const toggleFold = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!config || !onSave) return false;
    setSaving(true);
    try {
      await onSave(config);
      // What was sent, not what is current: an edit made mid-save leaves the
      // editor dirty, which is true, and the next save picks it up.
      setSaved(JSON.stringify(config));
      setError(null);
      setSaveFailed(false);
      return true;
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t save: ${e.message}` : 'Couldn’t save.');
      setSaveFailed(true);
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, onSave]);

  useAutosave({ dirty, saving, revision: config, enabled: autosave && !readOnly && onSave !== undefined, save });

  // The habit is older than autosave, and pressing it should not open a file
  // dialog over the editor.
  useEffect(() => {
    if (readOnly) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's' && onSave) {
        e.preventDefault();
        if (dirty && !saving) void save();
        return;
      }
      // A text field keeps its own undo; only the map's edits are ours.
      if ((e.target as HTMLElement).matches('input,textarea,select')) return;
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        (key === 'y' || e.shiftKey ? redo : undo)();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [dirty, saving, readOnly, onSave, save, undo, redo]);

  if (!flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--wui-bg)] px-6 text-center" data-workflow-ui="">
        <Workflow className="h-6 w-6 text-[var(--wui-fg-muted)]" aria-hidden />
        <p className="max-w-[52ch] text-[14px] text-[var(--wui-fg)]">This workflow isn’t laid out as a conversation, so there is no map to show.</p>
        {onOpenSteps && <Button onClick={onOpenSteps}>Open as steps</Button>}
      </div>
    );
  }

  const menuScreens = flow.screens.filter((s) => s.depth >= 0).length;
  const kids = childrenOf(flow);

  return (
    <div className="flex h-full flex-col bg-[var(--wui-bg)]" data-workflow-ui="">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--wui-border)] px-4">
        <p className="truncate text-[12.5px] text-[var(--wui-fg-muted)]" title={summaryOf(flow)}>
          <span className="font-semibold tabular-nums text-[var(--wui-fg)]">{menuScreens}</span> screens
          {ends.length > 0 && <> · finishes at <span className="text-[var(--wui-fg)]">{named(ends)}</span></>}
          {handoffs.length > 0 && <> · hands off at <span className="text-[var(--wui-fg)]">{named(handoffs)}</span></>}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {!readOnly && (
            ([[Undo2, 'Undo (Ctrl+Z)', undo, canUndo], [Redo2, 'Redo (Ctrl+Shift+Z)', redo, canRedo]] as const).map(([Icon, label, run, can]) => (
              <button key={label} type="button" title={label} aria-label={label.split(' ')[0]} disabled={!can} onClick={run} className="flex h-7 w-7 items-center justify-center rounded-[var(--wui-radius-sm)] text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)] disabled:cursor-not-allowed disabled:opacity-40">
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))
          )}
          {onOpenSteps && <Button variant="ghost" onClick={onOpenSteps}>Open as steps</Button>}
          {!readOnly && onSave && (autosave ? (
            /* A state of affairs, not a thing to press — so it does not look
               pressable. The one moment it becomes actionable is a save that
               failed, because autosave deliberately will not try again. */
            saveFailed && dirty ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-[var(--wui-radius-sm)] border border-[var(--wui-status-failed)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--wui-status-failed)] transition-colors hover:bg-[color-mix(in_srgb,var(--wui-status-failed)_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <AlertCircle className="h-3.5 w-3.5" aria-hidden />}
                {saving ? 'Saving…' : 'Not saved — retry'}
              </button>
            ) : (
              <p aria-live="polite" className="flex items-center gap-1.5 px-1 text-[12.5px] text-[var(--wui-fg-muted)]">
                {saving || dirty ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…</>
                ) : (
                  <><Check className="h-3.5 w-3.5" aria-hidden /> Saved</>
                )}
              </p>
            )
          ) : (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--wui-radius-sm)] px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed',
                dirty ? 'bg-[var(--wui-primary)] text-[var(--wui-primary-fg)] hover:bg-[var(--wui-primary-hover)]' : 'bg-[var(--wui-bg-muted)] text-[var(--wui-fg-muted)]',
              )}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {saving ? 'Saving' : dirty ? 'Save' : 'Saved'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 border-b border-[var(--wui-border)] bg-[color-mix(in_srgb,var(--wui-status-failed)_8%,var(--wui-bg))] px-4 py-2 text-[13px] text-[var(--wui-fg)]">
          <AlertCircle className="h-4 w-4 shrink-0 text-[var(--wui-status-failed)]" aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <FlowMap
            flow={flow}
            folded={folded}
            selected={selected}
            canEdit={!readOnly}
            focus={focus}
            onSelect={setSelected}
            onToggleFold={toggleFold}
            onFoldAll={() => setFolded(new Set(flow.screens.filter((s) => s.depth >= 1 && (kids.get(s.id)?.length ?? 0) > 0).map((s) => s.id)))}
            onUnfoldAll={() => setFolded(new Set())}
            onAdd={add}
            onDuplicate={duplicate}
            onSelectRouter={() => {
              const router = flowRouter(flow);
              if (router) setSelected(router.id);
            }}
          />
        </div>
        {lookup && (
          <CallPanel
            flow={flow}
            call={lookup.call}
            owner={lookup.owner}
            edit={edit}
            readOnly={readOnly}
            onSelect={reveal}
            onClose={() => setSelected(null)}
          />
        )}
        {screen && (
          // The agent fields are the agent step's own picker (its `getOptions`).
          <FieldOptionsScopeProvider scope={{ kind: 'steps', type: AGENT_STEP_TYPE, workflowId }}>
            <Inspector
              flow={flow}
              screen={screen}
              edit={edit}
              readOnly={readOnly}
              onSelect={reveal}
              onClose={() => setSelected(null)}
              onNewScreen={newScreen}
              onOpenSteps={onOpenSteps}
            />
          </FieldOptionsScopeProvider>
        )}
      </div>
    </div>
  );
}

/** What a new screen of each kind is called until its author says otherwise. */
function titleFor(type: NewScreenType): string {
  switch (type) {
    case 'end':
      return 'End of chat';
    case 'handoff':
      return 'Talk to a person';
    case 'ask-ai':
      return 'Ask AI';
    case 'menu':
      return 'New menu';
    default:
      return 'New screen';
  }
}

/**
 * Where a flow ends, in one line. A flow with an ending per branch has dozens,
 * and listing them all says less than counting them — so past a few it becomes
 * the count, with the whole list on the summary's tooltip.
 */
function named(screens: Screen[]): string {
  if (screens.length <= 3) return screens.map((s) => s.title).join(', ');
  return `${String(screens.length)} screens`;
}

function summaryOf(flow: ConversationalFlow): string {
  const list = (kind: ScreenKind) => flow.screens.filter((s) => s.kind === kind).map((s) => s.title);
  return [
    `Finishes at: ${list('end').join(', ') || 'nowhere'}`,
    ...(list('handoff').length > 0 ? [`Hands off at: ${list('handoff').join(', ')}`] : []),
  ].join('\n');
}
