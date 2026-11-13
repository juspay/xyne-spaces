import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Node, ElementNode, Scope, Registry } from './types.js';
import { evaluate } from './evaluate.js';
import { cn } from '../components/shared/cn.js';

/** Render a parsed template's nodes against a scope with a component registry. */
export function renderNodes(nodes: Node[], scope: Scope, registry: Registry): ReactNode[] {
  return nodes.map((n, i) => renderNode(n, scope, registry, String(i)));
}

function renderNode(node: Node, scope: Scope, registry: Registry, key: string): ReactNode {
  if (node.kind === 'text') return node.value;
  if (node.kind === 'expr') {
    const value = evaluate(node.expr, scope);
    const Value = registry['Value'];
    return Value ? Value.render({ value }, undefined, key) : stringify(value);
  }
  if (node.name === 'Each') return renderEach(node, scope, registry, key);
  if (node.name === 'Tabs') return renderTabs(node, scope, registry, key);
  if (node.name === 'If') return renderIf(node, scope, registry, key);
  const def = registry[node.name];
  if (!def) {
    return (
      <span key={key} className="rounded bg-[color-mix(in_srgb,#ef4444_12%,transparent)] px-1.5 py-0.5 font-mono text-[12px] text-red-600">
        &lt;{node.name}&gt; unknown
      </span>
    );
  }
  const props: Record<string, unknown> = {};
  for (const [name, av] of Object.entries(node.attrs)) {
    props[name] = av.kind === 'string' ? av.value : av.kind === 'bool' ? true : evaluate(av.expr, scope);
  }
  const mode = def.childMode ?? 'nodes';
  const kids = mode === 'text'
    ? textOf(node.children, scope)
    : mode === 'nodes'
      ? (node.children.length ? renderNodes(node.children, scope, registry) : undefined)
      : undefined;
  return def.render(props, kids, key);
}

/** Collapse children to a raw string (for text components like Code / Markdown). */
function textOf(nodes: Node[], scope: Scope): string {
  return nodes.map((n) => (n.kind === 'text' ? n.value : n.kind === 'expr' ? stringify(evaluate(n.expr, scope)) : '')).join('');
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function numAttr(node: ElementNode, name: string, scope: Scope): number | undefined {
  const a = node.attrs[name];
  if (!a) return undefined;
  const v = a.kind === 'expr' ? evaluate(a.expr, scope) : a.kind === 'string' ? Number(a.value) : undefined;
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
}

/**
 * `<Each in={list} as="item" cols={2}>…</Each>` — iterate an array (or an object's
 * entries, which bind as `{ key, value }`), rendering the children once per element
 * with `item` (+ `index`) added to scope, laid out as an N-column grid or a list.
 */
function renderEach(node: ElementNode, scope: Scope, registry: Registry, key: string): ReactNode {
  const inAttr = node.attrs['in'];
  const source = inAttr && inAttr.kind === 'expr' ? evaluate(inAttr.expr, scope) : undefined;
  const asAttr = node.attrs['as'];
  const as = asAttr && asAttr.kind === 'string' ? asAttr.value : 'item';
  const cols = numAttr(node, 'cols', scope);
  const items: unknown[] = Array.isArray(source)
    ? source
    : source && typeof source === 'object'
      ? Object.entries(source as Record<string, unknown>).map(([k, value]) => ({ key: k, value }))
      : [];
  if (items.length === 0) return <div key={key} className="text-[13px] italic text-[var(--wui-fg-muted)]">None</div>;
  const children = items.map((item, i) => (
    <div key={i} className="min-w-0">{renderNodes(node.children, { ...scope, [as]: item, index: i }, registry)}</div>
  ));
  if (cols && cols > 1) {
    return <div key={key} className="grid gap-x-8 gap-y-5" style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}>{children}</div>;
  }
  return <div key={key} className="flex flex-col gap-3">{children}</div>;
}

/**
 * `<Tabs in={list} as="item" label="name">…</Tabs>` — render an array as tabs, one
 * per element, but mount ONLY the active tab's children. Same per-item scope binding as
 * `Each`, so children reference the item via `as`. Use it for large per-item bodies
 * (e.g. OCR'd documents) where rendering every item at once is slow — the inactive tabs
 * cost nothing until selected. Tab labels come from each item's `label` field.
 */
function renderTabs(node: ElementNode, scope: Scope, registry: Registry, key: string): ReactNode {
  const inAttr = node.attrs['in'];
  const source = inAttr && inAttr.kind === 'expr' ? evaluate(inAttr.expr, scope) : undefined;
  const asAttr = node.attrs['as'];
  const as = asAttr && asAttr.kind === 'string' ? asAttr.value : 'item';
  const labelAttr = node.attrs['label'];
  const labelField = labelAttr && labelAttr.kind === 'string' ? labelAttr.value : undefined;
  const items: unknown[] = Array.isArray(source)
    ? source
    : source && typeof source === 'object'
      ? Object.entries(source as Record<string, unknown>).map(([k, value]) => ({ key: k, value }))
      : [];
  if (items.length === 0) return <div key={key} className="text-[13px] italic text-[var(--wui-fg-muted)]">None</div>;
  const labels = items.map((item, i) => {
    if (labelField && item && typeof item === 'object') {
      const v = (item as Record<string, unknown>)[labelField];
      if (v != null && v !== '') return String(v);
    }
    return `Item ${String(i + 1)}`;
  });
  return (
    <TabsView key={key} labels={labels} render={(i) => renderNodes(node.children, { ...scope, [as]: items[i], index: i }, registry)} />
  );
}

/** Tab bar + a single mounted panel (the active tab). Lazy: `render` runs only for the active index. */
function TabsView({ labels, render }: { labels: string[]; render: (i: number) => ReactNode }): ReactNode {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);
  const idx = active >= 0 && active < labels.length ? active : 0;
  // On a tab switch (not the initial mount), scroll the panel back up so the newly
  // selected document starts at the top — aligning our root with the scroll container's
  // top, which lands at scrollTop 0 when nothing sits above the tabs.
  useLayoutEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const root = rootRef.current;
    if (!root) return;
    let sc: HTMLElement | null = root.parentElement;
    while (sc && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (sc) sc.scrollTop += root.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  }, [idx]);
  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <div
        role="tablist"
        className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-[var(--wui-border)] bg-[var(--wui-bg)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            title={label}
            onClick={() => setActive(i)}
            className={cn(
              '-mb-px max-w-[24ch] shrink-0 truncate border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              i === idx
                ? 'border-[var(--wui-primary)] text-[var(--wui-fg)]'
                : 'border-transparent text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-w-0 flex-col gap-4">{render(idx)}</div>
    </div>
  );
}

/** `<If cond={expr}>…</If>` — render children only when the condition is truthy. */
function renderIf(node: ElementNode, scope: Scope, registry: Registry, key: string): ReactNode {
  const cond = node.attrs['cond'];
  const truthy = cond ? (cond.kind === 'expr' ? Boolean(evaluate(cond.expr, scope)) : cond.kind === 'bool') : false;
  return truthy ? <Fragment key={key}>{renderNodes(node.children, scope, registry)}</Fragment> : null;
}
