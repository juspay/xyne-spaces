/**
 * Layout engine — a small, safe, dependency-free JSX interpreter for node-carried
 * detail layouts. A step carries its layout as a JSX *string* (data); this engine
 * parses it into an AST, resolves `{expression}` refs against a data scope
 * (input / output / …), and renders whitelisted components. It is layout-only:
 * there is no arbitrary code execution (expressions are member/index/literal access
 * only) and all styling belongs to the components, not the template.
 */

// ─── AST ───

export type Expr =
  | { kind: 'ident'; name: string }
  | { kind: 'member'; obj: Expr; prop: string }
  | { kind: 'index'; obj: Expr; index: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'lit'; value: string | number | boolean | null };

export type AttrValue =
  | { kind: 'string'; value: string }
  | { kind: 'expr'; expr: Expr }
  | { kind: 'bool'; value: true };

export interface ElementNode { kind: 'element'; name: string; attrs: Record<string, AttrValue>; children: Node[] }
export interface ExprNode { kind: 'expr'; expr: Expr }
export interface TextNode { kind: 'text'; value: string }
export type Node = ElementNode | ExprNode | TextNode;

// ─── Runtime ───

/** The data a template can reference by expression (e.g. `output.response.pan`). */
export type Scope = Record<string, unknown>;

/** How a component consumes its children in a template. */
export type ChildMode =
  | 'nodes' // children are rendered elements (layout containers: Section, Row, Col …)
  | 'text'  // children collapse to a raw string (text + resolved exprs) — Markdown, Code
  | 'none'; // children are ignored (data comes from attributes) — Grid, Json, Table, Preview

export interface ComponentDef {
  /** props = resolved attributes; kids = rendered nodes, raw text, or undefined per childMode. */
  render: (props: Record<string, unknown>, kids: import('react').ReactNode | string | undefined, key: string) => import('react').ReactNode;
  childMode?: ChildMode;
}

export type Registry = Record<string, ComponentDef>;

export class LayoutError extends Error {}
