# Node-carried layout engine

A small, safe, dependency-free JSX interpreter that lets a **workflow node carry its own
detail UI as data**. The execution viewer renders each node's detail from a template string
stored on the node in the workflow config (`step.config.layout` / `trigger.config.layout`),
interpreted at runtime. The viewer stays generic — no per-node code — and workflows declare
their own presentation.

## TL;DR for agents

Two **config-carried, interpreted-generically** constructs (no workflow-specific ids ever live
in the frontend):

1. **`config.layout`** — a string of restricted JSX on a step/trigger → that node's detail UI.
   Rendered by this engine against a data scope (`input` / `output` / …).
2. **`config.groups[].pinned`** — `true` hoists a group to the top (Run level) of the Tabs
   sidebar. (Not this engine, but the same philosophy — see *Group hoisting* below.)

Authoring a layout = writing the template string onto the node in the DB/config (e.g. via `jq`).
The engine is **read-only** and **layout-only**: expressions are member/index/literal access +
a fixed set of pure functions — **no arbitrary code**, no method calls, no mutation, no I/O.
All styling is baked into the components (on `--wui-*` tokens); the template carries structure.

## Pipeline

`parse` (restricted JSX → AST) → `evaluate` (`{expr}` against the scope) → `render` (whitelisted
components). Entry point (`index.tsx`):

```ts
renderLayout(template: string, scope: Scope, registry?: Registry):
  | { ok: true;  node: ReactNode }
  | { ok: false; error: string }
```

Never throws — a malformed template returns `{ ok: false, error }` so the caller can show it
inline and fall back to the generic view.

## The scope — what a template can reference

| Context | Scope |
|---|---|
| A step node | `{ input, output, status, error }` |
| The trigger | `{ input }` (the trigger data), + `output/status/error` |
| Inside `<Each>` | the bound item (default name `item`) + `index`; iterating an **object** binds `{ key, value }` |

```jsx
{output.body.name_on_document}      // member access
{input.attachments[0]}              // index
{split(input.spoc, ' | ')[0]}       // function call, then index
```
Missing paths resolve to `undefined` (never throw).

## Syntax

- Elements: `<Name attr="str" attr={expr} flag>children</Name>` and self-closing `<Name />`.
- `{expression}` as a child, or as an attribute value.
- Plain text between tags (whitespace is collapsed).
- Expressions: identifiers, `.member`, `[index]`, `"str"` / `123` / `true` / `false` / `null`
  literals, and `fn(args)` calls. **No** operators, ternaries, or arbitrary JS.

### Whitelisted functions (`evaluate.ts`)

`split(s, sep)` · `first(a)` · `last(a)` · `at(a, i)` · `join(a, sep)` · `upper(s)` · `lower(s)`
· `trim(s)` · `len(a)` · `keys(o)` · `values(o)` · `pick(o, ...keys)`

### Control flow

```jsx
<Each in={output.rows} as="row" cols={2}>
  <Field label={row.label} stacked>{row.value}</Field>
</Each>

<If cond={output.flagged}>
  <Section title="Flags"> … </Section>
</If>
```
- `Each` iterates an array (or an object's entries → `{key, value}`); `cols={N}` lays it out as
  an N-column grid, otherwise a stacked list; empty source renders "None".
- `If` renders its children only when `cond` is truthy.

## Component library (`components.tsx` → `DEFAULT_REGISTRY`)

Structure only; visual style is baked in (do **not** put CSS in templates).

| Component | Key attrs | Children | Purpose |
|---|---|---|---|
| `Section` | `title` | nodes | Titled block with a divider rule. |
| `Row` | `cols` | nodes | `cols={N}` → N-column grid; else a wrapping flex row. |
| `Col` | `gap` | nodes | Vertical stack. |
| `Field` | `label`, `stacked`, `value`, `cite` | nodes | Label → value. Default: label left (bold) + value beside it. `stacked` → label above value. Value from `value={}` or from children. |
| `Value` | `value`, `cite` | — | Smart auto-renderer (also used for a bare `{expr}` child): bool→Yes/No, number, array→chips/cards, object→KV grid, attachment→doc card, long string→markdown. |
| `Markdown` | `value` | text | Render markdown (headings, tables, bold, …). |
| `Code` | `lang`, `value` | text | Code block. |
| `Json` | `data` | — | Pretty-printed JSON. |
| `Table` | `data`, `cite` | — | Array of objects → table (columns = union of keys). |
| `Grid` | `data`, `cite` | — | Object → aligned label/value grid. |
| `Matrix` | `data`, `rowKey`, `sub`, `values`, `cite` | — | Pivot `[{label, values:{col:val}}]` into label-rows × value-columns. |
| `Preview` | `src`, `height`, `width` | — | Attachment(s) → the app's document card (click → full preview popup); image URL → `<img>`. |
| `Link` | `href`, `label` | text | External link. |

### Citations (`cite`)

A cited agent step (`cite: true`) returns `response: { value, citation }`, where `citation`
mirrors the shape of `value` and every leaf is a list of sources. Pass that mirror to `cite`
and each value renders a ↗ marker per source — click to open the document at its page (with
the quoted passage highlighted) or the external link.

```jsx
<Field label="Total" value={output.response.value.total}
                     cite={output.response.citation.total} />
<Table data={output.response.value.rows}
       cite={output.response.citation.rows} />
```

Note the value path is `response.value.*` once `cite` is on. `cite` mirrors the value expression,
so containers (`Table`, `Grid`, `Matrix`) take the whole branch and match each cell up by
themselves. A bare `{expr}` child can't carry a `cite` — use `<Value value={…} cite={…}/>`.

**`childMode`** (per component) decides how children are consumed:
`'nodes'` = rendered elements (Section/Row/Field…), `'text'` = collapsed to a raw string
(Markdown/Code/Link), `'none'` = ignored, data comes from attributes (Grid/Json/Table/Preview/Value).

## How the execution viewer uses it (node-carried layouts)

- A step's detail layout lives on `step.config.layout`; the trigger's on `trigger.config.layout`.
- `ExecutionTabs` resolves the template for the open node with `walkStepConfigs`, which finds the
  step **anywhere in the tree** (nested branch / loop / case bodies included), then calls
  `renderLayout(template, { input, output, status, error })`.
- **No `config.layout` → the generic fallback** (`deriveSections` builds KV/table/markdown from the
  output). Every node renders something; a bespoke layout is an enhancement, not a requirement.
- To author: inspect the node's real output shape, then write the template onto the node, e.g.
  ```bash
  jq '.steps |= map(if .id=="bank_verify" then (.config.layout = $tpl) else . end)'
  ```

Example — a verification node:
```jsx
<Section title="PAN Verification">
  <Row cols={2}>
    <Field label="Name on PAN">{output.body.name_on_document}</Field>
    <Field label="Status">{output.body.status}</Field>
    <Field label="Verified">{output.body.verified}</Field>
    <Field label="Date of Birth">{output.body.dob}</Field>
  </Row>
</Section>
```

## Group hoisting — `config.groups[].pinned`

A sibling node-carried construct (lives in `ExecutionTabs` + `journey-model.ts`, not this engine).
Set `pinned: true` on a group and the Tabs sidebar lifts it to the **Run level** in workflow order,
and drops it from the nested tree so it isn't shown twice:

```jsonc
"groups": [ { "id": "g_report", "title": "7 · Report & Sign-off", "pinned": true } ]
```

Fully generic: the viewer hoists *whatever* groups carry the flag, resolves their position by
walking the config tree (`membersOfGroup` descends taken branches), and hides them in nested views
via a **path-aware** `hoistedIds` set — once you drill *into* a hoisted group, it stops being
hidden so its own content shows. Zero workflow-specific ids in the code.

### Whitelist mode — `config.display.onlyPinned`

By default `pinned` only *hoists* — every other step still renders in place. Set
`display.onlyPinned: true` on the workflow and `pinned` flips into a **visibility whitelist**: the
root sidebar shows **only** pinned groups; every non-pinned group and ungrouped step is dropped
(still reachable through the "Search all nodes" box, and still fully executed — this is purely
presentational). Use it to present a curated run — e.g. one cumulative report node — while the
intermediate plumbing stays out of the way:

```jsonc
"display": { "onlyPinned": true },
"groups":  [ { "id": "output", "title": "Cumulative CAM", "pinned": true } ]
```

A single-member pinned group surfaces its one node directly (and auto-opens on load, even while it's
still running, so it fills in live); a multi-member pinned group stays a drillable folder.

## Extending — add a component

Add an entry to a `Registry` and pass it to `renderLayout` (or spread `DEFAULT_REGISTRY`):

```tsx
const registry = {
  ...DEFAULT_REGISTRY,
  Badge: {
    childMode: 'text',
    render: (props, kids, key) =>
      <span key={key} className="rounded-full bg-[var(--wui-primary)] px-2 text-white">{kids}</span>,
  },
};
renderLayout(template, scope, registry);
```
`render(props, kids, key)`: `props` = resolved attributes, `kids` = rendered nodes / raw text /
`undefined` (per `childMode`), `key` = a React key you must spread onto your root element.

## Safety guarantees

- Expressions are member/index/literal + whitelisted pure functions only — **no `eval`**, no data
  method calls, no mutation, no I/O. A template can *transform* data it reads, never run code.
- Only registered component names render; an unknown tag shows an inline `<Name> unknown` marker.
- Parser and evaluator never throw to the UI — malformed input surfaces as an inline error and the
  node falls back to the generic view.

## Files

| File | Responsibility |
|---|---|
| `types.ts` | AST + runtime types: `Expr`, `Node`, `Scope`, `ChildMode`, `ComponentDef`, `Registry`, `LayoutError`. |
| `parse.ts` | Restricted-JSX parser → AST. |
| `evaluate.ts` | Expression evaluator + the whitelisted function table. |
| `render.tsx` | Node / `Each` / `If` rendering against the scope + registry. |
| `components.tsx` | The `DEFAULT_REGISTRY` component library. |
| `index.tsx` | `renderLayout` entry point. |

Consumers: `components/execution/ExecutionTabs.tsx` (reads `config.layout`, group hoisting) and
`components/execution/journey-model.ts` (tree / rollup / hoist model shared with the Journey view).
