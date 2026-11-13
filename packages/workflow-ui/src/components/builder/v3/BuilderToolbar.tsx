import { cn } from '../../shared/cn.js';

export interface BuilderToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Opens the workflow-variables panel. When omitted, no Variables button shows. */
  onOpenVariables?: () => void;
  variablesActive?: boolean;
  variablesCount?: number;
  showAiPanel?: boolean;
  onToggleAiPanel?: () => void;
}

function ToolbarButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 active:scale-95',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-slate-200" />;
}

export function BuilderToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  onOpenVariables,
  variablesActive,
  variablesCount,
  showAiPanel,
  onToggleAiPanel,
}: BuilderToolbarProps) {
  return (
    <div
      className={cn(
        'absolute bottom-4 left-1/2 z-20 -translate-x-1/2',
        'flex items-center gap-0.5 rounded-xl border border-slate-200/80 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur-sm',
        'animate-[wui-fade-in_200ms_ease-out]',
      )}
    >
      {/* Undo / Redo */}
      <ToolbarButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13" />
        </svg>
      </ToolbarButton>
      <ToolbarButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.69 3L21 13" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Zoom */}
      <ToolbarButton title="Zoom out" onClick={onZoomOut}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" />
        </svg>
      </ToolbarButton>
      <ToolbarButton title="Fit view" onClick={onFitView}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </ToolbarButton>
      <ToolbarButton title="Zoom in" onClick={onZoomIn}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" />
        </svg>
      </ToolbarButton>

      {onOpenVariables && (
        <>
          <Divider />
          <button
            title="Workflow variables — fixed values referenced as {{vars.key}}"
            onClick={onOpenVariables}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95',
              variablesActive
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
            </svg>
            Variables
            {variablesCount ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-semibold',
                  variablesActive ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-600',
                )}
              >
                {variablesCount}
              </span>
            ) : null}
          </button>
        </>
      )}

      {onToggleAiPanel && (
        <>
          <Divider />
          <button
            title={showAiPanel ? 'Close AI assistant' : 'Ask AI'}
            onClick={onToggleAiPanel}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all active:scale-95',
              showAiPanel
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'text-indigo-600 hover:bg-indigo-50',
            )}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Ask AI
          </button>
        </>
      )}
    </div>
  );
}
