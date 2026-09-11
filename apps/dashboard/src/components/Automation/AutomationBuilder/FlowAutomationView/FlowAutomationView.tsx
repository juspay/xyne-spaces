import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  Box,
  GitBranch,
  LayoutGrid,
  ListTree,
  Plus,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '../../../../utils/classNames';
import { Button } from '../../../ui/Button/Button';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import { ConditionalCard } from '../ConditionalCard/ConditionalCard';
import { ScheduleCard } from '../ScheduleCard/ScheduleCard';
import { StepCard } from '../StepCard/StepCard';
import { SwitchCard } from '../SwitchCard/SwitchCard';
import { TriggerCard } from '../TriggerCard/TriggerCard';
import type {
  ActionStepConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
} from '../../Automation.types';

import { summarizeCondition } from '../ConditionEditor/ConditionEditor.utils';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';
import { computeFlowLayout, VIRTUAL_ROOT_ID } from '../../../Board/FlowPlanEditor/FlowPlanEditor.utils';
import type { FlowItem, FlowNodeData, FlowAutomationViewProps, ViewStepPath } from './FlowAutomationView.types';
import {
  buildFlowItems,
  buildPathPrefix,
  buildVariableSourcesForPath,
  getContainerInfo,
  getEdgeLabel,
  getStepAtPath,
  issuesUnderPath,
  moveStepAtPath,
  removeStepAtPath,
  updateStepAtPath,
} from './FlowAutomationView.utils';

function ResolveIcon({
  name,
  className,
  fallback = Box,
}: {
  name: string | undefined;
  className?: string;
  fallback?: LucideIcon;
}): React.ReactElement {
  const Icon = name
    ? (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[name]
    : undefined;
  const IconComponent = Icon ?? fallback;
  return <IconComponent className={className} />;
}

function NodeButton({
  data,
  trackingName,
  className,
  children,
}: {
  data: FlowNodeData;
  trackingName: string;
  className?: string;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <button
      type='button'
      data-track-category='automation-builder-flow'
      data-track-name={trackingName}
      disabled={data.readOnly}
      onClick={() => data.onSelect(data.item.id)}
      className={cn(
        'relative block rounded-lg border bg-background text-left shadow-sm transition-shadow hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        data.selected && 'ring-2 ring-offset-1',
        className,
      )}
    >
      <Handle type='target' position={Position.Top} className='opacity-0' />
      {children}
      <Handle type='source' position={Position.Bottom} className='opacity-0' />
    </button>
  );
}

function TriggerNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeButton
      data={data}
      trackingName='select-trigger-node'
      className={cn(
        'w-[232px] border-amber-500/30 p-4',
        data.selected && 'ring-amber-500/40',
      )}
    >
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400'>
          <Zap className='size-5' />
        </div>
        <div className='flex min-w-0 flex-col'>
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            Trigger
          </span>
          <span className='truncate text-sm font-semibold text-foreground'>
            {(data.catalogItem?.name ?? 'Trigger') || 'Trigger'}
          </span>
        </div>
      </div>
    </NodeButton>
  );
}

function ActionNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeButton
      data={data}
      trackingName='select-action-node'
      className={cn('w-[232px] border-border p-4', data.selected && 'ring-blue-500/40')}
    >
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400'>
          <ResolveIcon name={data.catalogItem?.icon} className='size-5' />
        </div>
        <div className='flex min-w-0 flex-col'>
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {(data.catalogItem as { category?: string } | undefined)?.category ?? 'Action'}
          </span>
          <span className='truncate text-sm font-semibold text-foreground'>
            {data.item.label ?? data.catalogItem?.name ?? 'Action'}
          </span>
        </div>
      </div>
    </NodeButton>
  );
}

function ConditionalNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  const condition = (data.item.step as ConditionalStepConfig | undefined)?.config.condition;
  const summary = condition ? summarizeCondition(condition) : 'If / Else';
  const unset = summary === 'Click to set a condition' || summary === 'Condition';
  return (
    <NodeButton
      data={data}
      trackingName='select-conditional-node'
      className={cn(
        'w-[232px] border-purple-500/30 p-4',
        data.selected && 'ring-purple-500/40',
      )}
    >
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400'>
          <GitBranch className='size-5' />
        </div>
        <div className='flex min-w-0 flex-col'>
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            Control
          </span>
          <span className='truncate text-sm font-semibold text-foreground'>If / Else</span>
        </div>
      </div>
      <div
        className={cn(
          'mt-2 truncate rounded border px-2 py-1 text-xs',
          unset
            ? 'border-dashed border-border text-muted-foreground'
            : 'border-border bg-purple-500/5 text-foreground',
        )}
      >
        {unset ? 'Click to set condition' : summary}
      </div>
    </NodeButton>
  );
}

function SwitchNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  const sw = data.item.step as SwitchStepConfig | undefined;
  const caseCount = sw?.config.cases.length ?? 0;
  return (
    <NodeButton
      data={data}
      trackingName='select-switch-node'
      className={cn(
        'w-[232px] border-indigo-500/30 p-4',
        data.selected && 'ring-indigo-500/40',
      )}
    >
      <div className='flex items-center gap-3'>
        <div className='flex size-9 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'>
          <ListTree className='size-5' />
        </div>
        <div className='flex min-w-0 flex-col'>
          <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            Control
          </span>
          <span className='truncate text-sm font-semibold text-foreground'>Switch / Case</span>
        </div>
      </div>
      <div className='mt-2 truncate rounded border border-border bg-indigo-500/5 px-2 py-1 text-xs text-foreground'>
        {caseCount} case{caseCount === 1 ? '' : 's'}
        {sw?.config.default.length ? ' + default' : ''}
      </div>
    </NodeButton>
  );
}

function MergeNode({ data }: NodeProps<FlowNodeData>): React.ReactElement {
  return (
    <NodeButton
      data={data}
      trackingName='select-merge-node'
      className={cn(
        'size-4 rounded-full border-border p-0',
        data.selected && 'ring-foreground/40',
      )}
    />
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  conditional: ConditionalNode,
  switch: SwitchNode,
  merge: MergeNode,
};

const renderConditionalCard = (
  step: ConditionalStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <ConditionalCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

const renderSwitchCard = (
  step: SwitchStepConfig,
  props: ControlFlowRenderProps,
): React.ReactElement => (
  <SwitchCard
    step={step}
    catalog={props.catalog}
    schemaCache={props.schemaCache}
    schemaLoadingFor={props.schemaLoadingFor}
    operators={props.operators}
    variableSources={props.variableSources}
    index={props.index}
    total={props.total}
    onChange={next => props.onChange(next)}
    onMoveUp={props.onMoveUp}
    onMoveDown={props.onMoveDown}
    onDelete={props.onDelete}
    issues={props.issues}
    pathPrefix={props.pathPrefix}
    readOnly={props.readOnly ?? false}
    ensureSchema={props.ensureSchema}
    renderConditionalCard={props.renderConditionalCard}
    renderSwitchCard={props.renderSwitchCard}
  />
);

function useFlowGraph(
  config: FlowAutomationViewProps['config'],
  stepCatalog: FlowAutomationViewProps['stepCatalog'],
  triggerCatalog: FlowAutomationViewProps['triggerCatalog'],
  selectedNodeId: string | null,
  readOnly: boolean,
  onSelect: (id: string) => void,
): { items: FlowItem[]; nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const items = useMemo(() => buildFlowItems(config, stepCatalog), [config, stepCatalog]);

  const triggerCatalogItem = useMemo(
    () => triggerCatalog.find(c => c.type === config.trigger.type),
    [triggerCatalog, config.trigger.type],
  );

  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const layoutItems = items.map((item, order) => ({
      id: item.id,
      parentIds: item.parentIds,
      order,
      width: item.width,
      height: item.height,
    }));
    const positions = computeFlowLayout(layoutItems, 0);
    positions.delete(VIRTUAL_ROOT_ID);

    let minX = Infinity;
    let minY = Infinity;
    for (const position of positions.values()) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
    }
    const offsetX = Number.isFinite(minX) ? minX - 24 : 0;
    const offsetY = Number.isFinite(minY) ? minY - 24 : 0;

    const byId = new Map(items.map(item => [item.id, item]));
    const newNodes: Node<FlowNodeData>[] = items.map(item => {
      const position = positions.get(item.id) ?? { x: 0, y: 0 };
      const catalogItem =
        item.nodeType === 'trigger'
          ? triggerCatalogItem
          : stepCatalog.find(c => c.type === item.step?.type);
      return {
        id: item.id,
        type: item.nodeType,
        position: { x: position.x - offsetX, y: position.y - offsetY },
        data: {
          item,
          selected: item.id === selectedNodeId,
          readOnly,
          catalogItem,
          onSelect,
        },
        draggable: false,
        selectable: !readOnly,
        connectable: false,
        style: { width: item.width, height: item.height, padding: 0 },
      };
    });

    const newEdges: Edge[] = [];
    for (const item of items) {
      for (const parentId of item.parentIds) {
        const source = byId.get(parentId);
        const label = source ? getEdgeLabel(source, item) : undefined;
        newEdges.push({
          id: `${parentId}->${item.id}`,
          source: parentId,
          target: item.id,
          type: 'smoothstep',
          label,
          labelStyle: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' },
          labelBgStyle: { fill: 'hsl(var(--background))' },
          markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
          style: { stroke: 'hsl(var(--border))', strokeWidth: 1.5 },
        });
      }
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [items, selectedNodeId, readOnly, onSelect, triggerCatalogItem, stepCatalog]);

  return { items, nodes, edges };
}

function FlowAutomationViewInner(props: FlowAutomationViewProps): React.ReactElement {
  const {
    config,
    onConfigChange,
    triggerCatalog,
    triggerSchema,
    stepCatalog,
    stepSchemaCache,
    schemaLoadingFor,
    ensureSchema,
    operators,
    validation,
    readOnly,
    editMode,
    onAddStep,
    formFieldNameMap,
    onFormFieldNamesResolved,
  } = props;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const handleSelect = useCallback((id: string): void => setSelectedNodeId(id), []);
  const { items, nodes, edges } = useFlowGraph(
    config,
    stepCatalog,
    triggerCatalog,
    selectedNodeId,
    readOnly,
    handleSelect,
  );

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedNodeId) ?? null,
    [items, selectedNodeId],
  );

  const handleUpdateStep = (path: ViewStepPath, next: AutomationStepConfig): void => {
    onConfigChange(updateStepAtPath(config, path, next));
  };

  const handleDeleteStep = (path: ViewStepPath): void => {
    onConfigChange(removeStepAtPath(config, path));
    setSelectedNodeId(null);
  };

  const handleMoveStep = (path: ViewStepPath, direction: -1 | 1): void => {
    onConfigChange(moveStepAtPath(config, path, direction));
    setSelectedNodeId(null);
  };

  const renderEmptyPanel = (): React.ReactElement => {
    const hasTrigger = Boolean(config.trigger.type);
    return (
      <div className='flex flex-col gap-4'>
        <div className='rounded-md border border-border bg-background p-4'>
          <div className='mb-2 flex items-center gap-2 text-sm font-semibold text-foreground'>
            <LayoutGrid className='size-4 text-muted-foreground' />
            Flow view
          </div>
          <p className='text-xs text-muted-foreground'>
            Click any node to configure it. The list view is still available from the header toggle.
          </p>
        </div>
        {!hasTrigger && (
          <div className='rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground'>
            Choose a trigger first to start building the automation.
          </div>
        )}
        {hasTrigger && editMode && !readOnly && (
          <AddStepRow catalog={stepCatalog} onPick={type => onAddStep(type)} />
        )}
      </div>
    );
  };

  const renderTriggerPanel = (): React.ReactElement => {
    const triggerIssues = (validation?.issues ?? []).filter(i => i.path === 'trigger.config');
    return (
      <div className='flex flex-col gap-4'>
        <TriggerCard
          view='event'
          trigger={config.trigger}
          catalog={triggerCatalog}
          schema={triggerSchema}
          schemaLoading={false}
          onChangeType={type => onConfigChange({ ...config, trigger: { type, config: {} } })}
          onConfigChange={next => onConfigChange({ ...config, trigger: { ...config.trigger, config: next } })}
          issues={triggerIssues}
        />
        <TriggerCard
          view='condition'
          trigger={config.trigger}
          catalog={triggerCatalog}
          schema={triggerSchema}
          schemaLoading={false}
          onChangeType={type => onConfigChange({ ...config, trigger: { type, config: {} } })}
          onConfigChange={next => onConfigChange({ ...config, trigger: { ...config.trigger, config: next } })}
          issues={triggerIssues}
          onFormFieldNamesResolved={map => onFormFieldNamesResolved?.(map)}
        />
        <ScheduleCard
          schedule={config.schedule ?? { type: 'IMMEDIATE' }}
          triggerSchema={triggerSchema}
          onChange={next => onConfigChange({ ...config, schedule: next ?? { type: 'IMMEDIATE' } })}
        />
      </div>
    );
  };

  const renderActionPanel = (item: FlowItem): React.ReactElement | null => {
    const step = getStepAtPath(config, item.path) as ActionStepConfig | undefined;
    if (!step) return null;
    const catalogItem = stepCatalog.find(c => c.type === step.type) ?? null;
    const schema = stepSchemaCache[step.type] ?? null;
    const variableSources = buildVariableSourcesForPath(
      config,
      triggerSchema,
      stepSchemaCache,
      item.path,
      formFieldNameMap,
    );
    const issues = issuesUnderPath(validation?.issues, item.path, 'action');
    const containerInfo = getContainerInfo(config, item.path) ?? {
      steps: config.steps,
      index: item.path[1] as number,
    };
    const index = containerInfo.index + 1;
    const total = containerInfo.steps.length;
    return (
      <StepCard
        step={step}
        catalogItem={catalogItem}
        schema={schema}
        schemaLoading={schemaLoadingFor(step.type)}
        index={index}
        total={total}
        variableSources={variableSources}
        onConfigChange={next => handleUpdateStep(item.path, { ...step, config: next })}
        onMoveUp={() => handleMoveStep(item.path, -1)}
        onMoveDown={() => handleMoveStep(item.path, 1)}
        onDelete={() => handleDeleteStep(item.path)}
        issues={issues}
        pathPrefix={`${buildPathPrefix(item.path)}.config.`}
        readOnly={readOnly}
      />
    );
  };

  const renderConditionalPanel = (item: FlowItem): React.ReactElement | null => {
    const step = getStepAtPath(config, item.path) as ConditionalStepConfig | undefined;
    if (!step) return null;
    const variableSources = buildVariableSourcesForPath(
      config,
      triggerSchema,
      stepSchemaCache,
      item.path,
      formFieldNameMap,
    );
    const issues = issuesUnderPath(validation?.issues, item.path, 'conditional');
    const containerInfo = getContainerInfo(config, item.path) ?? {
      steps: config.steps,
      index: item.path[1] as number,
    };
    const index = containerInfo.index + 1;
    const total = containerInfo.steps.length;
    const props: ControlFlowRenderProps = {
      catalog: stepCatalog,
      schemaCache: stepSchemaCache,
      schemaLoadingFor,
      operators,
      variableSources,
      index,
      total,
      onChange: next => handleUpdateStep(item.path, next as ConditionalStepConfig),
      onMoveUp: () => handleMoveStep(item.path, -1),
      onMoveDown: () => handleMoveStep(item.path, 1),
      onDelete: () => handleDeleteStep(item.path),
      issues,
      pathPrefix: buildPathPrefix(item.path),
      readOnly,
      ensureSchema,
      renderConditionalCard,
      renderSwitchCard,
    };
    return renderConditionalCard(step, props);
  };

  const renderSwitchPanel = (item: FlowItem): React.ReactElement | null => {
    const step = getStepAtPath(config, item.path) as SwitchStepConfig | undefined;
    if (!step) return null;
    const variableSources = buildVariableSourcesForPath(
      config,
      triggerSchema,
      stepSchemaCache,
      item.path,
      formFieldNameMap,
    );
    const issues = issuesUnderPath(validation?.issues, item.path, 'switch');
    const containerInfo = getContainerInfo(config, item.path) ?? {
      steps: config.steps,
      index: item.path[1] as number,
    };
    const index = containerInfo.index + 1;
    const total = containerInfo.steps.length;
    const props: ControlFlowRenderProps = {
      catalog: stepCatalog,
      schemaCache: stepSchemaCache,
      schemaLoadingFor,
      operators,
      variableSources,
      index,
      total,
      onChange: next => handleUpdateStep(item.path, next as SwitchStepConfig),
      onMoveUp: () => handleMoveStep(item.path, -1),
      onMoveDown: () => handleMoveStep(item.path, 1),
      onDelete: () => handleDeleteStep(item.path),
      issues,
      pathPrefix: buildPathPrefix(item.path),
      readOnly,
      ensureSchema,
      renderConditionalCard,
      renderSwitchCard,
    };
    return renderSwitchCard(step, props);
  };

  const renderSidePanel = (): React.ReactElement => {
    if (!selectedItem || selectedItem.nodeType === 'merge') {
      return renderEmptyPanel();
    }
    if (selectedItem.nodeType === 'trigger') return renderTriggerPanel();
    if (selectedItem.nodeType === 'action') return renderActionPanel(selectedItem) ?? renderEmptyPanel();
    if (selectedItem.nodeType === 'conditional') return renderConditionalPanel(selectedItem) ?? renderEmptyPanel();
    if (selectedItem.nodeType === 'switch') return renderSwitchPanel(selectedItem) ?? renderEmptyPanel();
    return renderEmptyPanel();
  };

  return (
    <div className='flex flex-1 overflow-hidden'>
      <div className='flex-1 bg-muted/30'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={!readOnly}
          selectNodesOnDrag={false}
          panOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className='!bg-background/80 !border-border'
          />
        </ReactFlow>
      </div>
      <div className='flex w-96 flex-col overflow-hidden border-l border-border bg-background'>
        <div className='flex items-center justify-between border-b border-border px-4 py-3'>
          <span className='text-sm font-semibold text-foreground'>
            {selectedItem && selectedItem.nodeType !== 'merge' ? 'Configuration' : 'Builder'}
          </span>
          {selectedItem && selectedItem.nodeType !== 'merge' && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setSelectedNodeId(null)}
              className='h-7 text-xs'
            >
              Clear
            </Button>
          )}
        </div>
        <div className='flex-1 overflow-y-auto p-4'>{renderSidePanel()}</div>
        {editMode && !readOnly && selectedItem && selectedItem.nodeType !== 'merge' && (
          <div className='border-t border-border p-3'>
            <Button
              variant='outline'
              size='sm'
              className='w-full gap-1'
              onClick={() => handleDeleteStep(selectedItem.path)}
            >
              <Plus className='size-3.5 rotate-45' />
              Delete selected step
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowAutomationView(props: FlowAutomationViewProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <FlowAutomationViewInner {...props} />
    </ReactFlowProvider>
  );
}
