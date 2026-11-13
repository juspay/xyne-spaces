/**
 * The collapsible JSON tree used to show a step's raw output.
 *
 * Extracted from `StepDetailPanel` so the citation source panel shows a cited
 * step's output in exactly the same shape the graph side panel does — a reader
 * who clicks a citation should land on something they already recognise, not a
 * second, different rendering of the same data.
 */
import { useState } from 'react';
import { cn } from '../shared/cn.js';

// ─── JSON Tree Viewer ───

export function JsonTreeViewer({ data, placeholder }: { data?: unknown; placeholder: string }) {
  if (data === undefined || data === null || (typeof data === 'object' && Object.keys(data as object).length === 0)) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="mx-auto text-slate-300 mb-2">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="13 2 13 9 20 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-[12px] text-slate-400">{placeholder}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-mono text-[12px] leading-[1.6]">
      <JsonNode value={data} depth={0} isLast />
    </div>
  );
}

function JsonNode({ value, depth, keyName, isLast }: {
  value: unknown;
  depth: number;
  keyName?: string;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const indent = depth * 16;

  if (value === null) {
    return (
      <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
        {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
        <span className="text-slate-400 italic">null</span>
        {!isLast && <span className="text-slate-300">,</span>}
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
        {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
        <span className="text-violet-600">{value ? 'true' : 'false'}</span>
        {!isLast && <span className="text-slate-300">,</span>}
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
        {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
        <span className="text-blue-600">{String(value)}</span>
        {!isLast && <span className="text-slate-300">,</span>}
      </div>
    );
  }

  if (typeof value === 'string') {
    const isLong = value.length > 80;
    return (
      <div style={{ paddingLeft: indent }} className="group/val flex items-start gap-1">
        {keyName !== undefined && <span className="shrink-0 text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
        <span className={cn('text-emerald-700 break-all', isLong && 'block')}>
          &quot;{value}&quot;
        </span>
        {!isLast && <span className="text-slate-300 shrink-0">,</span>}
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
          {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
          <span className="text-slate-400">[]</span>
          {!isLast && <span className="text-slate-300">,</span>}
        </div>
      );
    }

    return (
      <div>
        <div
          style={{ paddingLeft: indent }}
          className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-50 rounded -mx-1 px-1 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="text-slate-400 w-3 text-center shrink-0 select-none">{collapsed ? '\u25B6' : '\u25BC'}</span>
          {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
          {collapsed ? (
            <>
              <span className="text-slate-400">[</span>
              <span className="text-slate-400 text-[10px]">{value.length} items</span>
              <span className="text-slate-400">]</span>
              {!isLast && <span className="text-slate-300">,</span>}
            </>
          ) : (
            <span className="text-slate-400">[</span>
          )}
        </div>
        {!collapsed && (
          <>
            {value.map((item, i) => (
              <JsonNode key={i} value={item} depth={depth + 1} keyName={String(i)} isLast={i === value.length - 1} />
            ))}
            <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
              <span className="w-3 shrink-0" />
              <span className="text-slate-400">]</span>
              {!isLast && <span className="text-slate-300">,</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
          {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
          <span className="text-slate-400">{'{}'}</span>
          {!isLast && <span className="text-slate-300">,</span>}
        </div>
      );
    }

    return (
      <div>
        <div
          style={{ paddingLeft: indent }}
          className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-50 rounded -mx-1 px-1 transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="text-slate-400 w-3 text-center shrink-0 select-none">{collapsed ? '\u25B6' : '\u25BC'}</span>
          {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
          {collapsed ? (
            <>
              <span className="text-slate-400">{'{'}</span>
              <span className="text-slate-400 text-[10px]">{entries.length} keys</span>
              <span className="text-slate-400">{'}'}</span>
              {!isLast && <span className="text-slate-300">,</span>}
            </>
          ) : (
            <span className="text-slate-400">{'{'}</span>
          )}
        </div>
        {!collapsed && (
          <>
            {entries.map(([k, v], i) => (
              <JsonNode key={k} value={v} depth={depth + 1} keyName={k} isLast={i === entries.length - 1} />
            ))}
            <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
              <span className="w-3 shrink-0" />
              <span className="text-slate-400">{'}'}</span>
              {!isLast && <span className="text-slate-300">,</span>}
            </div>
          </>
        )}
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div style={{ paddingLeft: indent }} className="flex items-baseline gap-1">
      {keyName !== undefined && <span className="text-slate-500">{keyName}<span className="text-slate-400">: </span></span>}
      <span className="text-slate-600">{String(value)}</span>
      {!isLast && <span className="text-slate-300">,</span>}
    </div>
  );
}