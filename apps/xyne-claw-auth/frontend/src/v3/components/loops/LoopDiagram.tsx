import { useMemo } from "react";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LoopTemplateInfo } from "../../../lib/api";
import { loopTemplateGraph, type FlowNodeData } from "../../lib/loopGraph";

const TONE: Record<NonNullable<FlowNodeData["tone"]>, string> = {
  start: "border-xyne-border-strong",
  end: "border-xyne-success-fg",
  pass: "border-xyne-brand",
  judge: "border-amber-500",
  checker: "border-sky-500",
  report: "border-xyne-border-strong",
  wait: "border-xyne-border",
};

function FlowNode({ data }: NodeProps) {
  const d = data as FlowNodeData;
  return (
    <div className={`w-[220px] rounded-xl border-2 bg-xyne-surface px-3 py-2 text-left shadow-sm ${TONE[d.tone ?? "pass"]}`}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-xyne-border-strong" />
      <p className="text-[12px] font-medium text-xyne-fg-primary">{d.label}</p>
      {d.hint && <p className="mt-0.5 text-[11px] leading-snug text-xyne-fg-muted">{d.hint}</p>}
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-xyne-border-strong" />
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

export function LoopDiagram({ template, height = 360 }: { template: LoopTemplateInfo; height?: number }) {
  const graph = useMemo(() => loopTemplateGraph(template), [template]);
  return (
    <div style={{ height }} className="rounded-xl border border-xyne-border bg-xyne-surface-sunken/40" data-id="loop-diagram">
      <ReactFlowProvider>
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges.map((e) => ({ ...e, labelStyle: { fontSize: 11 }, labelBgStyle: { fill: "var(--color-xyne-surface)" } }))}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1, minZoom: 0.2 }}
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
