import { memo, type ReactElement } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import { TYPE_META } from './typeMeta';
import { HEADER_H, NODE_W, ROW_H, type TableNodeData } from './utils';

const HANDLE_STYLE = { width: 7, height: 7, background: 'var(--border)', border: 'none' };

function TableNodeBase({ data }: NodeProps<TableNodeData>): ReactElement {
  const { schemaName, tableName, columns, fkColumns, pkColumns, matched, maxBodyHeight } = data;
  return (
    <div
      style={{ width: NODE_W }} // pinned to the layout's NODE_W so edges line up
      className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-opacity ${
        matched ? 'opacity-100' : 'opacity-40'
      }`}
    >
      <div
        className='flex items-center gap-2 px-3 bg-muted border-b border-border'
        style={{ height: HEADER_H }}
      >
        <Table2 size={14} className='text-muted-foreground shrink-0' />
        <span className='text-[13px] font-semibold text-foreground truncate'>{tableName}</span>
        {schemaName && schemaName !== 'public' && (
          <span className='ml-auto text-[10px] text-muted-foreground truncate'>{schemaName}</span>
        )}
      </div>
      <div className='overflow-y-auto' style={{ maxHeight: maxBodyHeight }}>
        {columns.map(c => {
          const isPk = pkColumns.has(c.columnName);
          const isFk = fkColumns.has(c.columnName);
          const meta = TYPE_META[c.dataTypeCanonical] ?? TYPE_META.unknown;
          return (
            <div
              key={c.id}
              className='relative flex items-center gap-1.5 px-3 hover:bg-accent'
              style={{ height: ROW_H }}
            >
              <Handle
                type='target'
                position={Position.Left}
                id={`t:${c.columnName}`}
                style={HANDLE_STYLE}
              />
              {isPk ? (
                <KeyRound size={11} className='text-amber-500 shrink-0' />
              ) : isFk ? (
                <Link2 size={11} className='text-primary shrink-0' />
              ) : (
                <span className='w-[11px] shrink-0' />
              )}
              <span
                className={`text-[12px] truncate ${
                  isPk ? 'font-medium text-foreground' : 'text-foreground/90'
                }`}
              >
                {c.columnName}
              </span>
              {c.isNullable && <span className='text-[9px] text-muted-foreground'>?</span>}
              <span className='ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground'>
                <meta.Icon size={10} className={meta.className} />
                {meta.label}
              </span>
              <Handle
                type='source'
                position={Position.Right}
                id={`s:${c.columnName}`}
                style={HANDLE_STYLE}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeBase);
