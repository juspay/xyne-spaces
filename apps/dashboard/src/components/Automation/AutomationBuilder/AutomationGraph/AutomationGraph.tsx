import { useMemo, useState, useCallback } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch } from 'lucide-react';
import { AUTO_NODE_TYPE, type AutoNodeData } from './automationGraph.types';
import { buildAutomationGraph } from './automationGraph.layout';
import { AutomationGraphContext, AutomationGraphNode } from './AutomationGraphNode';
import {
  AutomationConfigDrawer,
  type AutomationConfigDrawerProps,
  type DrawerSelection,
} from './AutomationConfigDrawer';

const nodeTypes = { [AUTO_NODE_TYPE]: AutomationGraphNode };

/**
 * Props are the union of what the layout needs and what the drawer forwards to
 * the reused cards. Everything is derived from the single `config` state owned
 * by {@link AutomationBuilder}, so Builder and Graph edit the same definition.
 */
export type AutomationGraphProps = Omit<AutomationConfigDrawerProps, 'selection' | 'onClose'> & {
  onAddStep: (type: string, insertAt?: number) => void;
};

function AutomationGraphInner(props: AutomationGraphProps): React.ReactElement {
  const { config, stepCatalog, triggerSchema, validationIssues, editMode } = props;
  const [selection, setSelection] = useState<DrawerSelection | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(
    () =>
      buildAutomationGraph({
        config,
        stepCatalog,
        triggerSchema,
        issues: validationIssues,
        editMode,
      }),
    [config, stepCatalog, triggerSchema, validationIssues, editMode],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_event, node: Node) => {
    const data = node.data as AutoNodeData;
    if (!data.interactive || data.kind === 'add') return;
    setSelectedNodeId(node.id);
    setSelection({ kind: data.kind, rootIndex: data.rootIndex });
  }, []);

  const closeDrawer = useCallback(() => {
    setSelection(null);
    setSelectedNodeId(null);
  }, []);

  const contextValue = useMemo(
    () => ({
      stepCatalog,
      editMode,
      selectedNodeId,
      onAddStep: props.onAddStep,
    }),
    [stepCatalog, editMode, selectedNodeId, props.onAddStep],
  );

  return (
    <div className='flex h-full min-h-0 w-full'>
      <div className='relative min-w-0 flex-1'>
        <AutomationGraphContext.Provider value={contextValue}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onPaneClick={closeDrawer}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            edgesFocusable={false}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: true }}
            className='bg-muted/20'
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className='!bg-background' />
            {config.steps.length === 0 && (
              <Panel position='top-center'>
                <div className='mt-2 flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm'>
                  <GitBranch className='size-3.5' aria-hidden='true' />
                  {editMode
                    ? 'Click a node to configure it, or the + to add your first step.'
                    : 'This automation has no steps yet.'}
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
