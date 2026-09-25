import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './automationGraph.css';
import { Eye, MousePointerClick, Pencil, Workflow } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import {
  AUTO_NODE_TYPE,
  STEP_KINDS,
  stepGraphId,
  type AutoNodeData,
  type AutomationGraphContextValue,
} from './automationGraph.types';
import {
  applyLayout,
  buildAutomationGraphModel,
  computeLayout,
  layoutKey,
  nodeSize,
} from './automationGraph.layout';
import { AutomationGraphContext, AutomationGraphNode } from './AutomationGraphNode';
import {
  AutomationConfigDrawer,
  resolveStepIndex,
  type AutomationConfigDrawerProps,
  type DrawerSelection,
} from './AutomationConfigDrawer';

const nodeTypes = { [AUTO_NODE_TYPE]: AutomationGraphNode };

const MINIMAP_COLOR: Record<string, string> = {
  trigger: '#f59e0b',
  schedule: '#0ea5e9',
  conditions: '#8b5cf6',
  action: '#3b82f6',
  conditional: '#10b981',
  switch: '#10b981',
};

const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 } as const;

/**
 * Props are the union of what the layout needs and what the drawer forwards to
 * the reused cards. Everything is derived from the single `config` state owned
 * by {@link AutomationBuilder}, so Builder and Graph edit the same definition.
 */
export type AutomationGraphProps = Omit<AutomationConfigDrawerProps, 'selection' | 'onClose'> & {
  onAddStep: (type: string, insertAt?: number) => void;
};

function focusNodeElement(nodeId: string): void {
  const el = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"] [data-slot='automation-graph-node']`,
  );
  el?.focus({ preventScroll: true });
}

function AutomationGraphInner(props: AutomationGraphProps): React.ReactElement {
  const { config, stepCatalog, triggerSchema, validationIssues, editMode } = props;
  const { setCenter, getZoom, fitView } = useReactFlow();
  const [selection, setSelection] = useState<DrawerSelection | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Model is rebuilt on every edit (cheap), but dagre only re-runs when the
  // graph's structure changes — typing into a field doesn't move nodes.
  const model = useMemo(
    () =>
      buildAutomationGraphModel({
        config,
        stepCatalog,
        triggerSchema,
        issues: validationIssues,
        editMode,
      }),
    [config, stepCatalog, triggerSchema, validationIssues, editMode],
  );
  const layoutCache = useRef<{ key: string; positions: ReturnType<typeof computeLayout> } | null>(
    null,
  );
  const key = layoutKey(model.nodes, model.edges);
  if (layoutCache.current?.key !== key) {
    layoutCache.current = { key, positions: computeLayout(model.nodes, model.edges) };
  }
  const positions = layoutCache.current.positions;
  const nodes = useMemo(() => applyLayout(model.nodes, positions), [model.nodes, positions]);

  const centerOn = useCallback(
    (nodeId: string) => {
      const pos = positions.get(nodeId);
      const n = model.nodes.find(x => x.id === nodeId);
      if (!pos || !n) return;
      const { width, height } = nodeSize(n.data.kind);
      void setCenter(pos.x + width / 2, pos.y + height / 2, {
        zoom: Math.max(getZoom(), 0.85),
        duration: 300,
      });
    },
    [positions, model.nodes, setCenter, getZoom],
  );

  const closeDrawer = useCallback(() => {
    const returnTo = selectedNodeId;
    setSelection(null);
    setSelectedNodeId(null);
    if (returnTo) requestAnimationFrame(() => focusNodeElement(returnTo));
  }, [selectedNodeId]);

  const onActivateNode = useCallback((nodeId: string, data: AutoNodeData) => {
    if (!data.interactive) return;
    if (data.kind === 'trigger' || data.kind === 'schedule' || data.kind === 'conditions') {
      setSelection({ kind: data.kind });
    } else if (STEP_KINDS.has(data.kind) && data.rootStepId) {
      setSelection({ kind: 'step', stepId: data.rootStepId });
    } else {
      return;
    }
    setSelectedNodeId(nodeId);
  }, []);

  // The drawer tracks a step by id; if that step is deleted (from the drawer or
  // an undo), close instead of showing whatever now sits at the old index.
  useEffect(() => {
    if (selection?.kind === 'step' && resolveStepIndex(config, selection) === -1) {
      setSelection(null);
      setSelectedNodeId(null);
    }
  }, [config, selection]);

  // When a single step is added while editing, open it and bring it into view
  // so the user can configure it immediately.
  const prevStepIds = useRef<string[]>(config.steps.map(s => s.id));
  useEffect(() => {
    const prev = new Set(prevStepIds.current);
    const added = config.steps.filter(s => !prev.has(s.id));
    const grewByOne = config.steps.length === prevStepIds.current.length + 1;
    prevStepIds.current = config.steps.map(s => s.id);
    const [newStep] = added;
    if (!editMode || !grewByOne || added.length !== 1 || !newStep) return;
    const id = stepGraphId(newStep);
    setSelection({ kind: 'step', stepId: newStep.id });
    setSelectedNodeId(id);
    requestAnimationFrame(() => centerOn(id));
  }, [config.steps, editMode, centerOn]);

  // Entering/leaving edit mode adds/removes the "+" affordances; re-frame.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    requestAnimationFrame(() => void fitView({ ...FIT_VIEW_OPTIONS, duration: 250 }));
  }, [editMode, fitView]);

  // Escape closes the drawer. Only keys pressed inside the graph count:
  // portaled popovers (selects, pickers) live outside it and keep their own
  // Escape, so dismissing a dropdown doesn't also close the editor.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selection) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!containerRef.current?.contains(e.target as globalThis.Node)) return;
      closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, closeDrawer]);

  const contextValue = useMemo<AutomationGraphContextValue>(
    () => ({
      stepCatalog,
      editMode,
      selectedNodeId,
      onAddStep: props.onAddStep,
      onActivateNode,
    }),
    [stepCatalog, editMode, selectedNodeId, props.onAddStep, onActivateNode],
  );

  const totalIssues = validationIssues?.length ?? 0;

  return (
    <div ref={containerRef} className='xyne-automation-graph relative flex h-full min-h-0 w-full'>
      <div className='relative min-w-0 flex-1'>
        <AutomationGraphContext.Provider value={contextValue}>
          <ReactFlow
            nodes={nodes}
            edges={model.edges}
            nodeTypes={nodeTypes}
            onPaneClick={() => selection && closeDrawer()}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
            aria-label='Automation graph'
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} position='bottom-left' />
            <MiniMap
              pannable
              zoomable
              position='bottom-right'
              ariaLabel='Automation overview'
              nodeBorderRadius={6}
              nodeColor={(n: Node) =>
                MINIMAP_COLOR[(n.data as AutoNodeData).kind] ?? 'rgba(148, 163, 184, 0.5)'
              }
            />
            <Panel position='top-left'>
              <div className='flex items-center gap-2'>
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm',
                    editMode
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-background/95 text-muted-foreground',
                  )}
                >
                  {editMode ? (
                    <Pencil className='size-3' aria-hidden='true' />
                  ) : (
                    <Eye className='size-3' aria-hidden='true' />
                  )}
                  {editMode ? 'Editing' : 'View only'}
                </span>
                {!editMode && props.onRequestEdit && (
                  <button
                    type='button'
                    onClick={props.onRequestEdit}
                    data-track-category='automation-graph'
                    data-track-name='canvas-edit'
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm',
                      'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                    )}
                  >
                    <Pencil className='size-3' aria-hidden='true' />
                    {props.editActionLabel ?? 'Edit'}
                  </button>
                )}
                {totalIssues > 0 && (
                  <span className='rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 shadow-sm dark:text-red-400'>
                    {totalIssues} issue{totalIssues === 1 ? '' : 's'} — look for flagged nodes
                  </span>
                )}
              </div>
            </Panel>
            {!selection && (
              <Panel position='top-center'>
                <div className='flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm'>
                  {config.steps.length === 0 ? (
                    <Workflow className='size-3.5' aria-hidden='true' />
                  ) : (
                    <MousePointerClick className='size-3.5' aria-hidden='true' />
                  )}
                  {config.steps.length === 0
                    ? editMode
                      ? 'No steps yet — use + below Conditions to add the first one.'
                      : 'This automation has no steps yet.'
                    : editMode
                      ? 'Select a node to configure it · use + to insert a step'
                      : 'Select a node to see its configuration'}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </AutomationGraphContext.Provider>
      </div>
      {selection && (
        <AutomationConfigDrawer {...props} selection={selection} onClose={closeDrawer} />
      )}
    </div>
  );
}

export function AutomationGraph(props: AutomationGraphProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <AutomationGraphInner {...props} />
    </ReactFlowProvider>
  );
}
