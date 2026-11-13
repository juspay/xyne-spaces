import { useState } from 'react';
import { cn } from './cn.js';

/**
 * Collapsible, syntax-coloured JSON tree. Used wherever a value is structured
 * data (markdown ```json blocks, the origin panel's full request/output) so the
 * reviewer can fold deep objects and scan values by colour instead of reading a
 * raw monospace dump. Colours map to --wui status/brand tokens so it blends.
 */

/** Parse text as JSON only when it actually looks like an object/array. */
export function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(t);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-[var(--wui-fg-muted)]">null</span>;
  switch (typeof value) {
    case 'string':
      return <span className="break-all text-[var(--wui-status-completed)]">&quot;{value}&quot;</span>;
    case 'number':
      return <span className="text-[var(--wui-status-paused)]">{String(value)}</span>;
    case 'boolean':
      return <span className="text-[var(--wui-status-running)]">{String(value)}</span>;
    default:
      return <span className="text-[var(--wui-fg)]">{String(value)}</span>;
  }
}

function Key({ name }: { name: string }) {
  return (
    <>
      <span className="text-[var(--wui-primary)]">&quot;{name}&quot;</span>
      <span className="text-[var(--wui-fg-muted)]">: </span>
    </>
  );
}

function Node({ name, value, depth, defaultOpen }: { name?: string | undefined; value: unknown; depth: number; defaultOpen: boolean }) {
  const isContainer = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(defaultOpen);

  if (!isContainer) {
    return (
      <div className="whitespace-nowrap pl-[1.05rem]">
        {name !== undefined && <Key name={name} />}
        <Primitive value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const [openBr, closeBr] = isArray ? ['[', ']'] : ['{', '}'];

  if (entries.length === 0) {
    return (
      <div className="whitespace-nowrap pl-[1.05rem]">
        {name !== undefined && <Key name={name} />}
        <span className="text-[var(--wui-fg-muted)]">{openBr}{closeBr}</span>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        className="flex w-full items-start gap-1 rounded text-left transition-colors hover:bg-[color-mix(in_srgb,var(--wui-fg)_5%,transparent)]"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('mt-[3px] h-3 w-3 shrink-0 text-[var(--wui-fg-muted)] transition-transform', open && 'rotate-90')}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="min-w-0">
          {name !== undefined && <Key name={name} />}
          <span className="text-[var(--wui-fg-muted)]">{openBr}</span>
          {!open && (
            <span className="text-[var(--wui-fg-muted)]">
              {' '}{entries.length} {isArray ? 'items' : 'keys'} {closeBr}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="ml-[0.34rem] border-l border-[color-mix(in_srgb,var(--wui-fg)_16%,transparent)] pl-2">
          {entries.map(([k, v]) => (
            <Node key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} defaultOpen={depth + 1 < 2} />
          ))}
          <div className="pl-[1.05rem] text-[var(--wui-fg-muted)]">{closeBr}</div>
        </div>
      )}
    </div>
  );
}

export function JsonView({ data, className }: { data: unknown; className?: string | undefined }) {
  return (
    <div className={cn('font-mono text-[11.5px] leading-relaxed', className)}>
      <Node value={data} depth={0} defaultOpen />
    </div>
  );
}
