# DPIP daily ingestion

TypeScript HTTP ingestion function for the DPIP daily registry datasets.

## Layout

- `src/`: authoritative TypeScript source.
- `migrations.md`: ordered database migration history.
- `test/`: parser tests, smoke-test script, and fixtures.
- `console-source/index.js`: generated single-file source for console deployment.
- `Report.html`: local report and payload helper.

## Commands

```sh
npm test
npm run build
```

`npm run build` compiles `dist/` and regenerates
`console-source/index.js` from `src/index.ts`.

The deployed HTTP function target is `ingestDpip`.

## Database setup

Apply the ordered migrations documented in `migrations.md`.
