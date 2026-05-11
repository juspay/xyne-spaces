## TestID Addition Rules:

### Navigation/Action Elements (Go back, Close, etc.)

- Always add `data-testid` to navigation links, back buttons, close buttons, and similar action elements even if they use `aria-label` or `getByRole`.
- Example: A "Go back" link should get `data-testid="canvas-go-back-btn"` or similar descriptive testid.
- These are first-party components — always safe to add testids.

### Third-Party Library Components (BlockNote, Lexical, TipTap, etc.)

- If the spec interacts with third-party editor components, add `data-testid` to the **wrapper/container** element that wraps the third-party component, NOT to the third-party component's internal elements.
- Example: If a BlockNote editor is wrapped in a `<div>`, add `data-testid="canvas-editor"` to that wrapper div.
- Do NOT modify third-party library source code.

### Dynamic Elements (List Items, Created Resources)

- Dynamic list items that already have testids like `data-testid={`canvas-item-${id}`}` are correct — do NOT change them.
- The test will use `I store the current path as "variable-name"` to capture dynamic URLs after creation, then `I open the Xyne-Space at "variable-name"` to navigate back. No testid changes needed for this pattern.
- Do NOT skip dynamic elements — their existing dynamic testids are fine.
