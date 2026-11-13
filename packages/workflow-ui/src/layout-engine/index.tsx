import type { ReactNode } from 'react';
import { parse } from './parse.js';
import { renderNodes } from './render.js';
import { DEFAULT_REGISTRY } from './components.js';
import { type Scope, type Registry, LayoutError } from './types.js';

export type RenderResult = { ok: true; node: ReactNode } | { ok: false; error: string };

/**
 * Parse + render a node-carried JSX layout template against a data scope.
 * Never throws — a malformed template returns `{ ok: false, error }` so the
 * caller can show it inline and fall back. The default registry is the built-in
 * component library; pass your own to extend it.
 */
export function renderLayout(template: string, scope: Scope, registry: Registry = DEFAULT_REGISTRY): RenderResult {
  try {
    const ast = parse(template);
    return { ok: true, node: <>{renderNodes(ast, scope, registry)}</> };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export { parse, DEFAULT_REGISTRY, LayoutError };
export type { Scope, Registry };
export type { Node, Expr, ComponentDef, ChildMode } from './types.js';
