import { ReactElement, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2 } from 'lucide-react';
import { useClawDigitalTwinGraph } from '@/hooks/useClawDigitalTwin';
import { TabMessage } from '@/routes/AIScreen/library/admin/components/TabMessage';
import { layoutSubsystems, makeSubsystemEdges } from '../components/graphLayout';
import { SubsystemMemoriesPanel } from '../components/SubsystemMemoriesPanel';

const DigitalTwinGraphTab = (): ReactElement => {
  const { data, isLoading } = useClawDigitalTwinGraph();
  const [selectedSubsystem, setSelectedSubsystem] = useState<string | null>(null);

  const nodes = useMemo(() => (data ? layoutSubsystems(data.subsystems, data.edges) : []), [data]);
  const edges = useMemo(() => (data ? makeSubsystemEdges(data.edges) : []), [data]);

  if (isLoading) {
    return (
      <div className='flex h-[420px] items-center justify-center rounded-lg border border-border bg-card'>
        <Loader2 className='size-5 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <TabMessage>
        No graph data — the subsystem graph will appear once you have approved memories.
      </TabMessage>
    );
  }

  return (
    <div className='flex gap-3'>
      <div className='h-[420px] flex-1 overflow-hidden rounded-lg border border-border bg-card'>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          attributionPosition='bottom-left'
          onNodeClick={(_, node) => setSelectedSubsystem(node.id)}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {selectedSubsystem && (
        <div className='h-[420px] w-[340px] shrink-0'>
          <SubsystemMemoriesPanel
            subsystem={selectedSubsystem}
            onClose={() => setSelectedSubsystem(null)}
          />
        </div>
      )}
    </div>
  );
};

export default DigitalTwinGraphTab;
