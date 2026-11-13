import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';

export interface TerminalNodeData {
  label: string;
}

export function TerminalNode({ data }: NodeProps) {
  const { label } = data as unknown as TerminalNodeData;

  return (
    <div className="flex w-48 items-center justify-center">
      <Handle
        type="target"
        position={Position.Top}
        className="!opacity-0"
      />
      <div className="flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4">
        <div className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
          {label || 'End'}
        </span>
      </div>
    </div>
  );
}
