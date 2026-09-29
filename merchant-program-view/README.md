# Merchant watch

Every ticket carrying a Merchant ID — from any board and any Xyne Desk — grouped into sub-ticket chains, with a merchant filter. Read-only; runs as the viewer.

- **Merchant IDs** come from the built-in `merchantId` column and from any custom field named "Merchant Id" / "Merchant ID" / "MID" (comma lists allowed; `NA`/`ALL` ignored). A ticket can belong to several merchants.
- **Cache:** after a load the data is saved to app storage, **private to each viewer**. Opening the app shows the cache at once and syncs only what changed since (new tickets, Desk email activity, activity on cached tickets). **Refresh** = sync; **Full reload** = everything. A full reload also runs automatically when the last one is over 24 h old.
- The cache needs an app id: until `spaces app push` has been run, it is off and every open is a full load (~8–9 min on the Juspay workspace).

## Run locally

    spaces token --update   # fills XYNE_TOKEN in .env (active Chrome workspace)
    npm run dev             # restart after changing .env
    npm test

## Ship

    spaces app push      # first push creates the app (private) and enables the cache
    spaces app publish   # workspace-visible

Design: xyne-spaces `docs/superpowers/specs/2026-09-28-merchant-program-view-design.md` (§11 covers custom fields and the cache).
