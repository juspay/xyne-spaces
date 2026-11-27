# @xyne/contracts

What the backend and the encryption extractor agree on about encrypted values. The clients
(dashboard, mobile) never load this package; their transit encryption lives in
`@xyne/shared` (`src/crypto`).

| File | What it holds |
|---|---|
| `src/mutator-contracts.ts` | Every Zero mutator's request contract, by name: its args schema (`unreadableString()` marks a sensitive arg) and `sourceToDerived` (the facts the mutator decides on). The backend mutator is `defineContractMutator('<name>', fn)`. |
| `src/contracts/` | Contracts of the encrypted REST routes. |
| `src/unreadable-string.ts` | `UnreadableString`, which prints as `<redacted>`, `unreadableString()`, and `reveal()`. |
| `src/define.ts` | `defineRequestContract` and the contract types. |
| `src/extractors.ts`, `src/extraction/` | The facts (`derive.*`) and the functions that extract them from plaintext (`runExtractors`). They run in the extractor sidecar, and in the backend when client encryption is off. |
| `src/compose.ts` | Compose templates: values the server stores but builds from encrypted parts (`runComposeTemplate`). |

## Adding a mutator

1. Add its contract to `src/mutator-contracts.ts`, keyed by the mutator's name.
2. Add its `MUTATOR` rule to the encryption service (a migration in the private repo): its plaintext args.
   Without one, enc-rust refuses the mutation (`ENC_CONTRACT_MISMATCH`).
3. Write `defineContractMutator('<name>', ({ tx, args, facts }) => …)` in `apps/backend/src/zero/mutators.ts`.

## Rules

- `reveal()` is used only in `src/unreadable-string.ts` (definition), `src/index.ts` (export) and
  `src/compose.ts` (the template runner). In the backend, only `zero/unreadableTransaction.ts` and
  `services/encryption/compose.ts` may call it. `scripts/validate-unreadable-boundaries.sh` enforces
  this in the backend `prebuild` and the pre-commit hook.
- The package depends on `@xyne/shared` (enums, schema helpers); `@xyne/shared` must never import it.

## Build and test

```bash
pnpm --filter @xyne/shared --filter @xyne/contracts run build
pnpm --filter @xyne/contracts test
```

Tests run under `tsx`: `@xyne/shared`'s build uses imports without file extensions, which plain Node
cannot load.
