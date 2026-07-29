import { useEffect, useMemo, type ReactElement } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { DataSourceSchema } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import { schemaToGraph, tableMatches, type TableNodeData } from './utils';
import { TableNode } from './TableNode';

const nodeTypes = { table: TableNode };

interface SchemaErdCanvasProps {
  schema: DataSourceSchema;
  search: string;
}

function FitToSearch({ search }: { search: string }): null {
  const rf = useReactFlow<TableNodeData>();
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (q === '') {
      // Clearing the search returns to the whole-diagram view instead of staying zoomed on the
      // last match.
      void rf.fitView({ duration: 400, padding: 0.2 });
      return;
    }
    const matched = rf.getNodes().filter(n => tableMatches(n.data.tableName, q));
    if (matched.length > 0) {
      void rf.fitView({ nodes: matched.map(n => ({ id: n.id })), duration: 400, padding: 0.3 });
    }
  }, [search, rf]);
  return null;
}

function CanvasInner({ schema, search }: SchemaErdCanvasProps): ReactElement {
  const base = useMemo(() => schemaToGraph(schema), [schema]);
  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges);

  // Re-seed when the schema (DB) changes.
  useEffect(() => {
    setNodes(base.nodes);
    setEdges(base.edges);
  }, [base, setNodes, setEdges]);

  // Dim non-matching tables without recomputing the layout (preserves drags).
  useEffect(() => {
    const q = search.trim().toLowerCase();
    setNodes(ns =>
      ns.map(n => {
        const matched = tableMatches(n.data.tableName, q);
        if (n.data.matched === matched) return n;
        return { ...n, data: { ...n.data, matched } };
      }),
    );
  }, [search, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      className='bg-background'
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
      <MiniMap pannable zoomable />
      <FitToSearch search={search} />
    </ReactFlow>
  );
}

export function SchemaErdCanvas(props: SchemaErdCanvasProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
