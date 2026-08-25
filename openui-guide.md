# OpenUI — A Working Guide

> Sources: [openui.com/docs](https://www.openui.com/docs/overview) (fetched 2026-08-17) plus the shipped source of `@openuidev/react-ui@0.13.6` on npm, which is where the theming and responsiveness answers actually come from — the docs are thin on both.

---

## 0. The mental model (read this first)

OpenUI is a **generative UI** toolkit from Thesys. Instead of your agent replying with markdown, it replies with a *description of an interface*, and your app renders that description using **your own React components**.

The key design decision: the LLM does **not** emit JSX, HTML, or JSON. It emits **OpenUI Lang** — a line-oriented mini-language:

```text
root = Stack([header, chart])
header = CardHeader("Revenue", "Last 30 days")
chart  = LineChart(["Jan","Feb","Mar"], [Series("MRR", [12, 18, 24])])
```

Five moving pieces:

| Piece | What it is | Where it runs |
|---|---|---|
| **Library** | Your components, each = Zod schema + React renderer | Client (defined once, shared) |
| **Prompt generator** | Turns the library into a system prompt (component signatures, syntax rules, examples) | Build time / server |
| **LLM** | Emits OpenUI Lang instead of markdown | Server |
| **Parser** | Line-by-line, streaming-safe; validates against the Zod schemas; drops invalid nodes | Client |
| **Renderer** | `<Renderer />` maps each parsed node → your React component, progressively | Client |

```
Your components ──▶ generated system prompt ──▶ LLM ──▶ OpenUI Lang stream ──▶ Parser ──▶ <Renderer /> ──▶ Live UI
```

**Why a language instead of JSON?** Three reasons the docs give:
- **Tokens** — JSON repeats `"component"`, `"props"`, `"children"` for every node. OpenUI Lang is positional. Claimed up to **67% fewer tokens** than JSON.
- **Streaming** — one statement per line means you can parse and render *each line as it arrives*, instead of waiting for a JSON object to close.
- **Robustness** — hallucinated component names and malformed nodes get dropped by the validator instead of crashing the render.

**The second big idea (this is the one people miss):** OpenUI separates **generation** from **execution**. The LLM writes the wiring *once* — including data fetches, state, and button actions — and then the UI runs **on its own**. Clicking a filter doesn't cost a token. This is what makes it viable for dashboards rather than just chat bubbles.

---

## 1. Creating generative UI — real code

### 1a. The 60-second path (scaffold)

```bash
npx @openuidev/cli@latest create --name genui-chat-app
cd genui-chat-app
echo "OPENAI_API_KEY=sk-your-key-here" > .env
npm run dev
```

You get a Next.js app:

```
src/
  app/
    page.tsx                     # AgentInterface chat + built-in component library
    api/chat/route.ts            # streaming backend + example tools
  library.ts                     # your component library entrypoint
  generated/
    system-prompt.txt            # generated prompt (static/legacy use)
    system-prompt.spec.json      # generated library spec ← the real source of truth
```

`dev`/`build` regenerate the prompt artifacts automatically:

```json
"generate:prompt": "openui generate src/library.ts --out src/generated/system-prompt.txt",
"dev": "pnpm generate:prompt && next dev"
```

Works with any OpenAI-compatible provider (OpenRouter, Azure, a proxy, etc.).

### 1b. The manual path — three files, end to end

**Install**

```bash
npm install @openuidev/react-lang @openuidev/react-ui
# backend-only prompt generation (no React):
npm install @openuidev/lang-core
```

**① `src/library.ts` — what the model is allowed to build with**

```ts
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

export default openuiLibrary;          // the CLI reads the default export
export { openuiPromptOptions };        // CLI auto-detects exported PromptOptions
```

Then generate the spec at build time:

```bash
npx @openuidev/cli@latest generate ./src/library.ts --out src/generated/system-prompt.txt
# writes system-prompt.txt AND system-prompt.spec.json
```

**② `src/app/api/chat/route.ts` — server: build the prompt, stream the model**

```ts
import OpenAI from "openai";
import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core";
import librarySpec from "@/generated/system-prompt.spec.json";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const systemPrompt = generateSystemPrompt({
  library: librarySpec as LibrarySpec,
  promptOptions: {
    preamble: "You are a helpful assistant. Reply with UI, not prose.",
  },
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const completion = await client.chat.completions.create({
    model: "gpt-5.4-mini",
    stream: true,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  });

  return new Response(completion.toReadableStream(), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

> `generateSystemPrompt` lives in `@openuidev/lang-core` — no React dependency, so it runs on Node, Edge, or serverless. There's also a frontend shorthand, `openuiLibrary.prompt(openuiPromptOptions)`, but it drags React components into your route. Prefer the spec.

**③ `src/app/page.tsx` — client: render the stream**

```tsx
"use client";
import "@openuidev/react-ui/components.css";
import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";

export function AssistantMessage({
  content,
  isStreaming,
}: {
  content: string | null;
  isStreaming: boolean;
}) {
  return (
    <Renderer
      library={openuiLibrary}
      response={content}          // raw accumulated OpenUI Lang text
      isStreaming={isStreaming}   // keep expecting more tokens
    />
  );
}
```

That's the whole loop. `response` is just the accumulated text — **the Renderer is transport-agnostic**. Vercel AI SDK, LangChain, raw `fetch`, SSE, whatever; if you can get a growing string to the client, it renders.

**With the Vercel AI SDK, for instance:**

```tsx
import { useChat } from "@ai-sdk/react";
import { Renderer } from "@openuidev/react-lang";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";

const { messages, sendMessage, status, stop } = useChat({ id: threadId });

<Renderer
  response={textContent}
  library={openuiChatLibrary}
  isStreaming={isStreaming}
  onAction={handleAction}
/>;
```

### 1c. The batteries-included path — `<AgentInterface>`

If you want the whole chat product (sidebar, thread list, composer, streaming, artifact panel, mobile layout) rather than just the renderer:

```tsx
import { AgentInterface, openAIAdapter, type ChatLLM } from "@openuidev/react-ui";
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";

const llm: ChatLLM = {
  send: ({ messages, signal }) =>
    fetch("/api/chat", { method: "POST", body: JSON.stringify({ messages }), signal }),
  streamProtocol: openAIAdapter(),
};

<AgentInterface
  llm={llm}
  componentLibrary={openuiChatLibrary}   // ← this single prop turns on GenUI
  agentName="Xyne"
  logoUrl="/logo.svg"
/>;
```

`llm` is the only required prop. Omit `storage` and threads live in memory (wiped on reload); pass a `ChatStorage` (`restStorage()` or your own) to persist.

### 1d. What the model actually emits

Given "Build a ticket tracker with a create form and table", the LLM outputs:

```text
$title = ""
$priority = "medium"
createResult = Mutation("create_ticket", {title: $title, priority: $priority})
tickets = Query("list_tickets", {}, {rows: []})
submitBtn = Button("Create", Action([@Run(createResult), @Run(tickets), @Reset($title, $priority)]))
form = Form("create", submitBtn, [
  FormControl("Title", Input("title", $title)),
  FormControl("Priority", Select("priority", $priority, [
    SelectItem("low", "Low"), SelectItem("medium", "Medium"), SelectItem("high", "High")
  ]))
])
tbl = Table([Col("Title", tickets.rows.title), Col("Priority", tickets.rows.priority)])
root = Stack([CardHeader("Ticket Tracker"), form, tbl])
```

Nine lines. That's a working CRUD app. (Section 4 covers the `Query`/`Mutation`/`@Run` half.)

### 1e. Language cheatsheet

One statement per line: `identifier = Expression`

| Type | Syntax | Example |
|---|---|---|
| Component call | `Type(a, b)` | `CardHeader("Title", "Subtitle")` |
| Built-in call | `@Name(args)` | `@Count(data.rows)` |
| String / Number / Bool / Null | `"x"` / `42` / `true` / `null` | |
| Array / Object | `[a, b]` / `{k: v}` | `{variant: "info"}` |
| Reference | `identifier` | `nameField` |
| State ref | `$identifier` | `$days` |
| Member access | `a.b.c` | `data.rows.title` |
| Ternary | `c ? a : b` | `$show ? form : null` |
| Binary ops | `+ - * / %`, `== != > < >= <=`, `&& \|\|`, `!` | `"" + $days + " days"` |

Rules that matter:
1. `root = ...` is the entry point. No root, nothing renders.
2. **Arguments are positional**, mapped by Zod object key order. `Stack([kids], "row", "l")` — *not* `Stack(children: ..., direction: ...)`.
3. Optional args can be omitted from the end.
4. **Forward references are allowed** — `root = Stack([chart])` can precede `chart = ...`. This is what makes top-down streaming work: the shell renders first, contents fill in.
5. `data.rows.title` on an array is a **column pluck** — extracts `title` from every row.

Common built-in signatures:

```text
Stack(children, direction?, gap?, align?, justify?, wrap?)
Card(children, variant?, direction?, gap?, align?, justify?, wrap?)
TextContent(text, size?)
Form(name, fields, buttons)          FormControl(label, input, hint?)
Input(name, placeholder?, type?, rules?)   Select(name, items, placeholder?, rules?)
Button(label, action, variant?, type?, size?)   Buttons(buttons, direction?)
Tabs(items)  TabItem(value, trigger, content)
Table(columns)  Col(label, data, type?)
BarChart(labels, series, variant?, xLabel?, yLabel?)
```

Full generated list: `openuiLibrary.prompt(openuiPromptOptions)`.

---

## 2. How components render, how they match your app's look, and responsiveness

### 2a. The render pipeline

1. **Tokens arrive.** `<Renderer response={...} isStreaming />` gets the raw growing string.
2. **Parser re-runs on every chunk.** It's line-oriented, so a complete line = a renderable node. Partial trailing lines are ignored until complete.
3. **Validation against your Zod schemas.** Positional args → named props by key order. Bad nodes are *dropped*, not rendered as holes:
   - unresolved references and unknown components are removed from arrays (no `null` gaps)
   - `meta.orphaned` lists defined-but-unreachable statements each chunk (great for live debugging)
4. **Mapping.** Each node's `name` is looked up in your library; the matching React `component` is rendered with the validated props and a `renderNode` function for children.
5. **Progressive paint.** Because `root` comes first and forward refs resolve later, the layout shell appears immediately and fills in.

Errors are surfaced structurally, not swallowed:

| Code | Source | Meaning |
|---|---|---|
| `unknown-component` | parser | Name not in library |
| `missing-required` / `null-required` | parser | Required prop absent/null |
| `excess-args` | parser | More positional args than schema params (extras dropped, still renders) |
| `inline-reserved` | parser | `Query`/`Mutation` used inline instead of top-level |
| `parse-failed` / `parse-exception` | parser | No renderable root / crash on malformed input |
| `tool-not-found` | query | Tool name missing from `toolProvider` |
| `runtime-error` / `render-error` | runtime | Expression eval failed / React component threw |

Without an `onError` handler these go to `console.warn`. With one, you get a self-correction loop for free:

```tsx
<Renderer
  library={library}
  response={code}
  onError={(errors) => {
    if (!errors.length) return;      // called with [] when resolved
    const msg = errors
      .map((e) => `[${e.source}] ${e.statementId ?? ""}: ${e.message}${e.hint ? `\nHint: ${e.hint}` : ""}`)
      .join("\n\n");
    sendToLLM(`Fix these errors:\n\n${msg}`);
  }}
/>
```

**Full `<Renderer />` prop list:**

| Prop | Type | Purpose |
|---|---|---|
| `response` | `string \| null` | Raw OpenUI Lang text |
| `library` | `Library` | From `createLibrary(...)` |
| `isStreaming` | `boolean` | Stream in progress |
| `onAction` | `(e: ActionEvent) => void` | Structured action events |
| `onStateUpdate` | `(state) => void` | Fires on every form field change |
| `initialState` | `Record<string, any>` | Hydrate persisted form state |
| `onParseResult` | `(r) => void` | Debug the parse tree |
| `toolProvider` | function map \| MCP client \| null | Executes `Query()`/`Mutation()` |
| `queryLoader` | `ReactNode` | Custom loading indicator |
| `onError` | `(errors) => void` | LLM-friendly structured errors |

### 2b. Matching your app's aesthetics — three levels

**Level 1 — retheme the built-in library with design tokens.** The built-in components are styled entirely from `--openui-*` CSS custom properties. `ThemeProvider` takes a camelCase theme object, kebab-cases the keys, and injects them as CSS vars (default selector: `body`).

```tsx
import { ThemeProvider, createTheme } from "@openuidev/react-ui";

<ThemeProvider
  mode="dark"                                  // "light" | "dark"
  lightTheme={createTheme({
    interactiveAccentDefault: "oklch(0.60 0.20 260)",
    background:               "oklch(0.98 0 0)",
    radiusM:                  "10px",
    fontBody:                 '"Söhne", system-ui, sans-serif',
    barChartPalette:          ["oklch(0.6 0.2 260)", "oklch(0.7 0.15 160)"],
  })}
  darkTheme={createTheme({ interactiveAccentDefault: "oklch(0.45 0.20 260)" })}
  cssSelector="body"
>
  <App />
</ThemeProvider>
```

Nice details from the source:
- Every key is optional; omitted keys fall back to built-in defaults.
- **If you pass only `lightTheme`, those overrides apply to both modes** — so single-brand customisation "just works".
- In dev builds, unknown keys get a `console.warn` with a Levenshtein-based *"did you mean…?"* suggestion. Stripped in production.
- Portals get a `portalThemeClassName` so dropdowns/modals inherit the same vars.
- On `AgentInterface`, pass `theme={...}` directly, or `disableThemeProvider` if your app already wraps it in a compatible provider (avoids nesting two).

The token surface (from `ThemeProvider/types.ts`) is genuinely large — this is a real design system, not a colour prop:

- **Color** — surfaces (`background`, `foreground`, `sunk*`, `elevated*`, `overlay`, `highlight*`), semantic backgrounds (`info/success/alert/danger/purple/pink`), text ramps (`textNeutralPrimary/Secondary/Tertiary`, `textBrand`, `textAccent*`, `textSuccess*`, `textDanger*` incl. inverted sets), interactive states (`interactiveAccentDefault/Hover/Pressed/Disabled`, destructive equivalents), borders (`borderDefault/Interactive/Accent/Info/Alert/Success/Danger` + `*Emphasis`, `*Selected`), chat colors. **All values are `oklch()` strings.**
- **Layout** — `space000 … space3xl` (12 steps), `radiusNone … radius9xl` + `radiusFull`.
- **Typography** — 5 font families (`fontBody/Code/Heading/Label/Numbers`), 10 sizes, 4 weights, line heights, letter spacings, plus **compound shorthands** like `--openui-text-heading-md: 600 24px/1.1 "Inter", sans-serif` for every text style.
- **Effects** — `shadow0 … shadow3xl`, with different intensities per mode.
- **Charts** — per-chart palettes: `defaultChartPalette`, `barChartPalette`, `lineChartPalette`, `areaChartPalette`, `pieChartPalette`, `radarChartPalette`, `radialChartPalette`, `horizontalBarChartPalette`.

You can also skip React and just override the vars in CSS — `@openuidev/react-ui/components.css` defines them on `:root` with a `@media (prefers-color-scheme: dark)` block:

```css
:root {
  --openui-interactive-accent-default: oklch(0.60 0.20 260);
  --openui-radius-m: 10px;
  --openui-font-body: "Söhne", system-ui, sans-serif;
}
```

**Level 2 — wrap your own design system.** OpenUI Lang describes *abstract structure*; your library decides how it renders. The official shadcn example replaces the whole component set while keeping the protocol identical:

```tsx
const ChatCard = defineComponent({
  name: "Card",
  props: z.object({ children: z.array(ChatCardChildUnion) }),
  description:
    "Vertical container for all content in a chat response. Children stack top to bottom automatically.",
  component: ({ props, renderNode }) => (
    <Card>
      <CardContent className="p-0 space-y-3">{renderNode(props.children)}</CardContent>
    </Card>
  ),
});

export const shadcnChatLibrary = createLibrary({
  root: "Card",
  componentGroups: shadcnComponentGroups,
  components: [ChatCard, CardHeader, TextContent, Alert /* ...40+ */],
});
```

Swap in MUI, Radix, or your in-house primitives and **nothing else in the stack changes**. This is the honest answer to "how does it match my app's aesthetics": *because they're your components.* The AI picks structure; you own pixels.

**Level 3 — replace surfaces around the UI.** On `AgentInterface`: `components={{ AssistantMessage, UserMessage }}` (precedence: `components` > `componentLibrary` > built-in default), plus slots for `Sidebar`, `ThreadHeader`, `Welcome`, `Composer`, `Workspace`, and branding props `logoUrl` / `agentName`.

### 2c. Responsiveness — the accurate picture

There is **no responsive syntax in OpenUI Lang**. The model cannot emit breakpoints, and there's no `sm:`/`md:` concept. Responsiveness comes from three places instead:

**1. Components are intrinsically fluid.** `Stack` compiles straight to flexbox with token-based gaps — no fixed widths anywhere:

```tsx
// @openuidev/react-ui/src/genui-lib/Stack/index.tsx (abridged)
component: ({ props, renderNode }) => (
  <div style={{
    display: "flex",
    flexDirection: props.direction ?? "column",
    gap: gapMap[props.gap || "m"],            // → var(--openui-space-m)
    alignItems: alignMap[props.align],
    justifyContent: justifyMap[justify],
    flexWrap: props.wrap ? "wrap" : undefined,
  }}>{renderNode(props.children)}</div>
)
```

The documented pattern for grids is therefore `Stack` with `direction: "row"` and `wrap: true` — cards reflow by wrapping rather than by breakpoint. (There's even a guard in the source: `wrap` + `justify: "between"` silently degrades to `"start"`, because space-between on a wrapped last row looks broken.)

**2. Individual components handle their own overflow.** e.g. charts:

```css
.openui-bar-chart-main-container { width: 100%; overflow-x: auto; scrollbar-width: none; }
```

Wide content scrolls inside its own box instead of blowing out the page.

**3. The chat shell carries the actual breakpoints.** Grepping every stylesheet in `@openuidev/react-ui@0.13.6` turns up exactly these:

| Query | Count | What it's for |
|---|---|---|
| `@media (max-width: 768px \| 560px \| 480px \| 400px)` | 5 | `AgentInterface` shell — sidebar collapse, mobile header, composer |
| `@media (hover: none)` | 1 | Touch devices |
| `@media (prefers-reduced-motion: reduce)` | 4 | Motion safety |
| `@media (prefers-color-scheme: dark)` | 1 | Default dark tokens |

**Zero container queries** — no `@container`, no `container-type` anywhere in the package.

**Practical takeaways:**
- Built-in components adapt by being fluid (100% width, flex, wrap, internal scroll), not by breakpoints. In a chat column, in a sidebar, or full-page, they fill their parent.
- The framing "responsive component library" in the docs mostly means *fluid + mobile-tested chat shell*, plus a claim that OpenUI **Cloud** ships a "pre-tested, responsive, accessible" set.
- **For your own components, responsiveness is your job.** Since custom components are plain React, add container queries yourself — arguably better than media queries here, since generated UI can land in a 400px chat bubble or a full-width dashboard:

  ```tsx
  const StatGrid = defineComponent({
    name: "StatGrid",
    description: "Responsive grid of stat cards.",
    props: z.object({ cards: z.array(StatCard.ref) }),
    component: ({ props, renderNode }) => (
      <div style={{ containerType: "inline-size" }}>
        <div className="stat-grid">{renderNode(props.cards)}</div>
      </div>
    ),
  });
  ```
  ```css
  .stat-grid { display: grid; gap: var(--openui-space-m); grid-template-columns: 1fr; }
  @container (min-width: 480px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
  @container (min-width: 800px) { .stat-grid { grid-template-columns: repeat(4, 1fr); } }
  ```
  Then tell the model when to use it via a `componentGroups` note (see §3d). Using `--openui-*` tokens keeps it visually consistent with the built-ins.

---

## 3. Creating and using custom components

### 3a. The core API

```tsx
import { defineComponent, createLibrary } from "@openuidev/react-lang";
import { z } from "zod/v4";   // works with both zod@3.25.x and zod@4

const StatCard = defineComponent({
  name: "StatCard",                            // the call name in OpenUI Lang
  description: "Displays a metric label and value.",  // goes into the system prompt
  props: z.object({                            // key order = positional arg order
    label: z.string(),
    value: z.string(),
  }),
  component: ({ props }) => (
    <div>
      <strong>{props.label}</strong>
      <div>{props.value}</div>
    </div>
  ),
});

export const myLibrary = createLibrary({
  root: "StatCard",
  components: [StatCard],
});
```

Four required fields: `name`, `props`, `description`, `component`. The renderer receives `{ props, renderNode }`.

`root` is the enforced entry point — the generated prompt tells the model "every program must define `root = <RootName>(...)`". It (a) constrains output to a known top-level shape and (b) enables streaming, since the shell renders before children arrive. Built-ins: `openuiLibrary` → `Stack`, `openuiChatLibrary` → `Card`.

### 3b. Nesting with `.ref`

```tsx
const Item = defineComponent({
  name: "Item",
  description: "Simple item",
  props: z.object({ label: z.string() }),
  component: ({ props }) => <div>{props.label}</div>,
});

const List = defineComponent({
  name: "List",
  description: "List of items",
  props: z.object({ items: z.array(Item.ref) }),   // ← .ref is the composition primitive
  component: ({ props, renderNode }) => <div>{renderNode(props.items)}</div>,
});
```

`z.array(Child.ref)` is idiomatic: the LLM emits each child as its own line, which streams and validates independently.

**Multiple allowed child types** — use a union:

```tsx
const TabItemSchema = z.object({
  value: z.string(),
  trigger: z.string(),
  content: z.array(z.union([TextBlock.ref, CalloutBlock.ref])),
});
```

**Naming helper schemas** so the prompt doesn't say `any`:

```tsx
import { tagSchemaId } from "@openuidev/react-lang";

const ActionExpression = z.any();
tagSchemaId(ActionExpression, "ActionExpression");   // → prompt shows `action?: ActionExpression`
```

### 3c. Hooks available inside custom components

| Hook | Use |
|---|---|
| `useStateField(name, value?)` | **Preferred.** Unified form-state + reactive `$variable` binding → `{ value, setValue }` |
| `useIsStreaming()` | Still receiving tokens |
| `useIsQueryLoading()` | A `Query()` this component depends on is in flight |
| `useTriggerAction()` | Fire an action back to the app/LLM |
| `useRenderNode()` | Render children (also passed as the `renderNode` prop) |
| `useFormValidation()` | `{ errors, validateField, registerField, validateForm, ... }` |
| `useFormName()` / `useGetFieldValue()` / `useSetFieldValue()` / `useSetDefaultValue()` | Lower-level field access |

A reactive input needs `reactive()` on the prop so the model may bind a `$variable` to it:

```tsx
import { useStateField, reactive } from "@openuidev/react-lang";

const MySelect = defineComponent({
  name: "MySelect",
  description: "Dropdown bound to reactive state.",
  props: z.object({
    name: z.string(),
    value: reactive(z.string().optional()),   // ← allows $variable binding
    items: z.array(SelectItem.ref),
  }),
  component: ({ props }) => {
    const field = useStateField(props.name, props.value);
    return (
      <select value={field.value ?? ""} onChange={(e) => field.setValue(e.target.value)}>
        {/* ... */}
      </select>
    );
  },
});
```

When the prop is a `$variable`, `setValue` writes to the store and **triggers all dependent queries and expressions to re-evaluate**. That's the whole reactivity contract.

A button that talks back to the LLM:

```tsx
const MyButton = defineComponent({
  name: "MyButton",
  description: "A clickable button.",
  props: z.object({ label: z.string() }),
  component: ({ props }) => {
    const triggerAction = useTriggerAction();   // (userMessage, formName?, action?)
    return <button onClick={() => triggerAction(props.label)}>{props.label}</button>;
  },
});
```

Loading states, matching the built-ins:

```tsx
import { Skeleton, TableSkeleton } from "@openuidev/react-ui";
// <Skeleton count={3} height="16px" />   <TableSkeleton rows={5} columns={4} />
```

Built-in `Table` renders `TableSkeleton` automatically when `useIsQueryLoading()` is true and no rows exist yet.

### 3d. Assembling and teaching the library

```ts
const library = createLibrary({
  root: "Stack",
  components: [Stack, Card, TextContent, Form, FormControl, Input, Button, Buttons, StatGrid],
  componentGroups: [
    {
      name: "Forms",
      components: ["Form", "FormControl", "Input", "TextArea", "Select"],
      notes: [
        "- Define EACH FormControl as its own reference for progressive streaming.",
        "- NEVER nest Form inside Form.",
        "- Form requires explicit buttons: Form(name, buttons, fields).",
      ],
    },
    {
      name: "Layout",
      components: ["Stack", "Tabs", "TabItem", "Accordion", "AccordionItem", "StatGrid"],
      notes: [
        '- For grid-like layouts, use Stack with direction "row" and wrap=true.',
        "- Use StatGrid for 2-8 KPI tiles; it reflows on narrow containers.",
      ],
    },
  ],
});
```

`componentGroups` sections the generated prompt (Layout / Forms / Charts …) so the model can find things instead of scanning a flat list, and co-locates components that belong together. `notes` are injected verbatim after the group's signatures — **this is your main steering wheel** for output quality.

Extra prompt customisation:

```ts
import type { PromptOptions } from "@openuidev/react-lang";

const options: PromptOptions = {
  preamble: "You are an assistant that outputs only OpenUI Lang.",
  additionalRules: ["Always use Card as the root for chat responses."],
  examples: [`root = Stack([title])\ntitle = TextContent("Hello", "large-heavy")`],
};

const prompt = library.prompt(options);
```

### 3e. Extending the built-in library instead of starting over

```ts
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui";
import { z } from "zod";

const ProductCard = defineComponent({
  name: "ProductCard",
  description: "Product tile",
  props: z.object({ name: z.string(), price: z.number() }),
  component: ({ props }) => <div>{props.name}: ${props.price}</div>,
});

const myLibrary = createLibrary({
  root: openuiLibrary.root ?? "Stack",
  componentGroups: openuiLibrary.componentGroups,
  components: [...Object.values(openuiLibrary.components), ProductCard],
});
```

Then **regenerate the prompt** (`openui generate ./src/library.ts`) — the model can only use what's in the spec.

### 3f. Design rules for LLM-authored UI

Because the *model* writes the calls, component design directly affects output quality:

- **Keep schemas flat.** Deeply nested object props burn tokens and raise error rates. Prefer several simple components over one deep one.
- **Order Zod keys deliberately.** Required first, optional last; put the most distinctive prop at position 0 — the model sees it first.
- **Use descriptive names.** `PricingTable` beats `Table3`. `description` reinforces it.
- **Limit library size.** Every component inflates the system prompt. Fewer components = less confusion, better output.
- **Compose with `.ref`, don't deep-nest.** Each child becomes its own line: streams and validates independently.
- **Give 1–2 examples in `PromptOptions`.** Disproportionately effective for unusual shapes.
- **Use groups + notes** to encode taste ("BarChart for comparisons, LineChart for trends").

---

## 4. Actions and data sources — live data

This is the part that separates OpenUI from "LLM writes a chart config".

### 4a. Two different loops

**Loop A — back to the model.** A button or follow-up produces an `ActionEvent`; you decide what to do (usually: send it as the next turn).

```tsx
<Renderer
  library={myLibrary}
  response={content}
  onAction={(event) => {
    if (event.type === "continue_conversation") {
      // event.humanFriendlyMessage — button label / follow-up text
      // event.formState           — field values at time of click
      // event.formName            — scoping form, if any
      // event.params              — extra params from the component
      sendMessage(event.humanFriendlyMessage);
    }
  }}
/>
```

Built-in dispatched types: `continue_conversation` (`@ToAssistant`) and `open_url` (`@OpenUrl`).

**Loop B — no model at all.** `@Run`, `@Set`, `@Reset` are handled *internally by the runtime* and never reach `onAction`. This is where live data lives: filters, refetches, mutations, form resets — all zero-token.

### 4b. Reading live data — `Query`

```text
data = Query("list_tickets", {}, {rows: []})
```

| Position | Meaning |
|---|---|
| 1 | Tool name (must exist in your `toolProvider`) |
| 2 | Arguments (may reference `$variables`) |
| 3 | **Default value** — renders immediately, before the tool responds |
| 4 | *(optional)* refresh interval, seconds |

Queries execute on load. Results are just data:

```text
tbl   = Table([Col("Title", data.rows.title), Col("Status", data.rows.status)])
chart = LineChart(data.rows.day, [Series("Views", data.rows.views)])
```

**Reactive queries** — put a `$variable` in the args and it re-fetches on change:

```text
$days  = "7"
data   = Query("analytics", {days: $days}, {rows: []})
filter = Select("days", $days, [SelectItem("7", "7 days"), SelectItem("30", "30 days")])
```

User picks "30" → `$days` updates → query re-fetches with `{days: "30"}` → chart updates. No `useEffect`, no event wiring, **no LLM call**.

**Auto-refresh** — fourth arg, in seconds:

```text
health = Query("get_server_health", {}, {cpu: 0, memory: 0}, 30)
```

### 4c. Writing data — `Mutation`

```text
createResult = Mutation("create_ticket", {title: $title, priority: $priority})
```

Mutations **do not run on load**. They fire only via `@Run` inside an `Action`:

```text
submitBtn = Button("Create", Action([@Run(createResult), @Run(tickets), @Reset($title)]))
```

Steps run in order; **if `@Run(mutation)` fails, the remaining steps are skipped.** Feedback via `result.status`:

```text
createResult.status == "error"   ? Callout("error", "Failed", createResult.error) : null
createResult.status == "success" ? Callout("success", "Created", "Ticket added.")  : null
```

### 4d. Reactive state and computation

```text
$days = "7"          $title = ""          $showEdit = false
```

| Step | Effect |
|---|---|
| `@Set($var, value)` | Change a variable |
| `@Reset($v1, $v2)` | Restore declared defaults |
| `@Run(ref)` | Execute a Mutation / re-fetch a Query |
| `@ToAssistant("msg")` | Send a message to the LLM |
| `@OpenUrl("url")` | Open a URL in a new tab |

When a `$variable` changes: bound inputs update → dependent `Query` calls re-fetch → dependent expressions re-evaluate → UI re-renders. Conditionals are ternaries: `$showEdit ? editForm : null`.

Data transforms use `@`-prefixed built-ins (included in the prompt whenever `toolCalls` or `bindings` is on):

- **Aggregate:** `@Count`, `@Sum`, `@Avg`, `@Min`, `@Max`, `@First`, `@Last`
- **Filter/sort:** `@Filter(array, field, op, value)` (`== != > < >= <= contains`), `@Sort(array, field, "asc"|"desc")`
- **Math:** `@Round(n, decimals?)`, `@Abs`, `@Floor`, `@Ceil`
- **Iterate:** `@Each(array, "t", Tag(t.priority, null, "sm"))`

Composed — the canonical KPI card:

```text
kpi = Card([
  TextContent("Open Tickets", "small"),
  TextContent("" + @Count(@Filter(data.rows, "status", "==", "open")), "large-heavy")
])
```

### 4e. Connecting your data sources — `toolProvider`

**Option 1 — function map** (plain async functions; can call your API, your DB via a route, or a third-party API straight from the browser):

```tsx
<Renderer
  library={library}
  response={code}
  toolProvider={{
    list_tickets: async (args) => fetch("/api/tickets").then((r) => r.json()),
    create_ticket: async (args) =>
      fetch("/api/tickets", { method: "POST", body: JSON.stringify(args) }).then((r) => r.json()),
  }}
/>
```

**Option 2 — MCP client** (server-side tools):

```tsx
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp")));

<Renderer toolProvider={client} library={library} response={code} />;
```

Both snippets are simplified — in production you handle auth, error boundaries, and connection lifecycle yourself.

### 4f. Full live-data flow

**① Declare tools for the prompt** (so the model knows what exists):

```ts
const tools: ToolSpec[] = [
  {
    name: "list_tickets",
    description: "List all tickets",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, priority: { type: "string" } },
          },
        },
      },
    },
  },
  {
    name: "create_ticket",
    description: "Create a new ticket",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, priority: { type: "string" } },
    },
    outputSchema: { type: "object", properties: { success: { type: "boolean" } } },
  },
];
```

> **The `outputSchema` is load-bearing.** It's how the model knows to write `tickets.rows.title` — without it, it's guessing at your response shape.

**② Generate the prompt with tool features on:**

```ts
const systemPrompt = generateSystemPrompt({
  library: componentSpec as LibrarySpec,
  promptOptions: {
    tools,
    toolCalls: true,   // Query(), Mutation(), @Run, built-ins
    bindings: true,    // $variables, @Set, @Reset
    editMode: true,    // incremental patches instead of full regeneration
    inlineMode: true,  // model may mix prose + fenced code
    toolExamples: [`tickets = Query("list_tickets", {}, {rows: []})\n...`],
    additionalRules: ['Use @Reset after form submit, not @Set($var, "")'],
  },
});
```

| Flag | Enables | Default |
|---|---|---|
| `toolCalls` | `Query()`, `Mutation()`, `@Run`, built-ins, tool workflow rules | `true` if `tools` provided |
| `bindings` | `$variables`, `@Set`, `@Reset`, reactive filters | `true` if `toolCalls` |
| `editMode` | Incremental editing — model emits only changed statements | `false` |
| `inlineMode` | Text + fenced-code responses (answer without regenerating UI) | `false` |

**③ Render with a provider:**

```tsx
<Renderer
  library={library}
  response={streamedText}
  isStreaming={isStreaming}
  toolProvider={{
    list_tickets: async () => db.query("SELECT * FROM tickets"),
    create_ticket: async (args) => db.query("INSERT INTO tickets ...", args),
  }}
/>
```

**Runtime sequence** for the ticket tracker in §1d:
1. `Query("list_tickets")` → runtime calls your tool → table fills
2. User types a title, picks a priority, clicks **Create**
3. `@Run(createResult)` → runtime calls `create_ticket` directly
4. `@Run(tickets)` → re-fetches `list_tickets` → table updates
5. `@Reset($title, $priority)` → form clears

All of it **without the LLM**. Same story for the official dashboard example, which shares one `tools.ts` registry between `/api/mcp` (runtime execution) and `/api/chat` (prompt generation) — one source of truth, two consumers.

### 4g. Persisting interaction state

```tsx
<Renderer
  library={myLibrary}
  response={content}
  onStateUpdate={(state) => saveToBackend(state)}   // fires on every field change
  initialState={loadedState}                        // hydrate on load
/>
```

The state format is opaque — persist and rehydrate as-is. On `AgentInterface` this is automatic: a half-filled form survives a reload.

Validation is built in too: `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, extensible via `builtInValidators`, surfaced to components through `useFormValidation()`.

### 4h. Iterating on a live UI — incremental editing

With `editMode: true`, "add a pie chart" doesn't regenerate everything. The model emits only the delta:

```text
root  = Stack([header, chart, tbl])          ← redefined
chart = PieChart(["Open", "Closed"], [
  @Count(@Filter(tickets.rows, "status", "==", "open")),
  @Count(@Filter(tickets.rows, "status", "==", "closed"))
], "donut")                                  ← new
```

Merge rules: same name → replaces; new name → added; absent from patch → kept; remove from `root`'s children → becomes unreachable and gets garbage-collected. Existing queries, state, and bindings survive intact.

Claimed: ~20 statements / ~400 tokens / ~2s → 2 statements / ~60 tokens / ~0.3s. **~85% fewer tokens.**

---

## 5. Gotchas and production notes

- **`root` is mandatory.** No `root = ...` statement → nothing renders (`parse-failed`).
- **Positional only.** `Stack([kids], "row", "l")`, never named args. Zod key order *is* the API — reordering keys is a breaking change for every prompt you've generated.
- **Regenerate the spec after any library change.** Wire `openui generate` into `dev` and `build`; a stale spec means the model writes calls your library no longer has.
- **`Query`/`Mutation` must be top-level statements** — inline usage errors with `inline-reserved`.
- **`Form` requires explicit buttons.**
- **`@Count(...)` not `Count(...)`.** Bare built-in names are unsupported.
- **Mutations never run on load** — only via `@Run`.
- **Handle `onError`** or errors just land in `console.warn`. The structured payload is designed to be fed straight back to the model for self-correction.
- **Keys never reach the browser.** Provider calls happen on your route; `fetchLLM()` only ever talks to your own endpoint. With tools, the model *proposes* name + args; your server executes.
- **Chat vs standalone library.** `openuiChatLibrary` (root `Card`, adds `FollowUpBlock`/`ListBlock`/`SectionBlock`, no `Stack`) for chat; `openuiLibrary` (root `Stack`, full layout suite incl. `Tabs`, `Carousel`, `Accordion`, `Modal`) for dashboards, playgrounds, embeds.
- **Import the CSS** — `@openuidev/react-ui/components.css` — or nothing is styled.
- **Managed option.** OpenUI Cloud adds model fallbacks, streaming-path output validation/correction, provider-quirk normalisation, conversation persistence, monitoring, and prebuilt slides/reports artifacts. Self-hosting is fully supported; the adapters are documented.

---

## 6. Package map

| Package | Use it for |
|---|---|
| `@openuidev/lang-core` | Framework-agnostic parser, prompt generation, runtime eval. No React. Backend/Edge. |
| `@openuidev/react-lang` | `defineComponent`, `createLibrary`, `<Renderer />`, hooks |
| `@openuidev/react-ui` | `AgentInterface`, `openuiLibrary` / `openuiChatLibrary`, `ThemeProvider`, skeletons |
| `@openuidev/react-headless` | Chat state, streaming adapters, message converters — bring your own UI |
| `@openuidev/cli` | `openui create`, `openui generate` |
| `@openuidev/langchain` | Stream LangChain/LangGraph agents over AG-UI |
| `@openuidev/react-email` | 44 React Email components + prompt options |
| `@openuidev/vue-lang`, `@openuidev/svelte-lang` | Vue 3 / Svelte 5 bindings |
| `@openuidev/browser-bundle` | CDN / iframe / no-build embeds |
| `@openuidev/devtools` | Dev-only inspector widget |

---

## 7. Where to go next

- **Overview** — https://www.openui.com/docs/overview
- **Architecture (generate vs execute)** — https://www.openui.com/docs/openui-lang/how-it-works
- **Language spec v0.5** — https://www.openui.com/docs/openui-lang/specification-v05
- **Defining components** — https://www.openui.com/docs/openui-lang/defining-components
- **Queries & mutations** — https://www.openui.com/docs/openui-lang/queries-mutations
- **Reactive state** — https://www.openui.com/docs/openui-lang/reactive-state
- **System prompts** — https://www.openui.com/docs/openui-lang/system-prompts
- **Patterns (worked examples)** — https://www.openui.com/docs/openui-lang/patterns
- **shadcn example** (bring-your-own design system) — https://www.openui.com/docs/openui-lang/examples/shadcn-chat
- **Dashboard example** (MCP + live tools) — https://www.openui.com/docs/openui-lang/examples/dashboard
- **Playground** — https://www.openui.com/playground · **Demos** — https://www.openui.com/demos
- **Source** — https://github.com/thesysdev/openui
- **Docs for your coding agent** — https://www.openui.com/llms.txt and https://www.openui.com/llms-full.txt (MCP setup at `/docs/mcp`)
