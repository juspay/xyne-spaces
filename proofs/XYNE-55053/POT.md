# Proof of Test — XYNE-55053

**[FE-Perf][P1] Fix AI streaming list rerenders (XyneAISidebar)**

Covers findings **F37** (inline `onFeedback` arrow defeats `MessageItem`'s `React.memo`)
and **F38** (`O(n²)` `botTurnIndex` computation in the render loop).

## What changed
`apps/dashboard/src/components/Chat/XyneAISidebar/XyneAISidebar.tsx`

- **F37** — Added a stable, void-returning `handleFeedbackVoid = useCallback(…, [handleFeedback])`
  and pass `onFeedback={handleFeedbackVoid}` instead of a fresh inline arrow per render.
  The conditional callbacks (`onRegenerate`, `onEditSubmit`, `onEditMobile`, `onBranchNavigate`,
  `onDebug`, `onOpenToolDebug`) were already `undefined` for non-latest rows, so `onFeedback`
  was the one always-passed prop defeating the memo for every row.
- **F38** — Pre-compute a `botTurnIndexById` map in a single `O(n)` pass inside the existing
  index memo; the render loop now does an `O(1)` `botTurnIndexById.get(id) ?? -1` instead of
  `displayMessages.slice(0, index+1).filter(...).length - 1` per bot message.

## How to reproduce the POT
```
node proofs/XYNE-55053/bench_f38_botturnindex.cjs
node proofs/XYNE-55053/proof_f37_memo.cjs
cd apps/dashboard && npx tsc --noEmit --project tsconfig.app.json
cd apps/dashboard && npx eslint src/components/Chat/XyneAISidebar/XyneAISidebar.tsx
```

## Results

### F38 — botTurnIndex O(n²) → O(n)
Correctness first: both implementations produce **identical** `botTurnIndex` values
(asserted for n ∈ {1,2,3,10,51,200}) — the fix is behaviour-preserving.

| n | BEFORE (O(n²)) | AFTER (O(n)) | speedup |
|---|---|---|---|
| 50 | 0.0043 ms | 0.0017 ms | 2.6× |
| 100 | 0.0136 ms | 0.0034 ms | 4.1× |
| 500 | 0.2978 ms | 0.0169 ms | 17.6× |
| 1000 | 1.2943 ms | 0.0384 ms | 33.7× |

BEFORE grows quadratically; AFTER stays flat.

### F37 — React.memo bail-out (uses React's real `shallowEqual` comparator)
- `Object.is` on `onFeedback` across renders: **BEFORE = false** (new arrow each render),
  **AFTER = true** (stable useCallback).
- Wasted re-renders over 100 streaming tokens: **BEFORE = 100/100** (re-renders every token),
  **AFTER = 0/100** (bails out every token).
- Scaled to a 50-message list: **BEFORE = 5000** wasted `MessageItem` renders,
  **AFTER = 0**.

### Gates
- `tsc --noEmit` → **0 errors**
- `eslint XyneAISidebar.tsx` → **0 errors** (pre-existing warnings only, none introduced)
- Dashboard boots in the sandbox browser → **0 console errors** (Vite compiled the change).

Raw captured output is in `proofs/XYNE-55053/out/`.
