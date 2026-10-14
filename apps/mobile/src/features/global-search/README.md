# Global Search

One screen (`app/(protected)/global-search.tsx`) that searches messages,
tickets, files and calls on the backend, and people, DMs and channels on the
device.

## Data flow

```
route params ─► scope (a locked conversation — never state, never a chip)

SearchScreen
│  useSearchState()   { tab, query, chips, onlyMyChannels, trigger }
│
├─ SearchInput        the text being typed is local state
│                     ├─ debounced 250ms, at most 700ms ─► query
│                     └─ live `from:` / `in:` detection ─► trigger
├─ SearchCategoryTags
├─ GlobalSearchFilterBar
└─ SearchResults      mounts one list for what is on screen
     ├─ trigger active    ─► From / In suggestions     (on-device)
     ├─ DMs, Channels     ─► use-directory-search      (on-device)
     └─ Messages, Tickets,
        Files, Calls      ─► buildSearchRequest ─► useSearchResults ─► /vespaSearch
```

| To change                                       | Look in                                 |
| ----------------------------------------------- | --------------------------------------- |
| Whether a request is sent, and its query params | `utils/search-request.ts`               |
| Fetching, cancelling, error messages            | `hooks/use-search-results.ts`, `api.ts` |
| Tab, filter and query state                     | `hooks/use-search-state.ts`             |
| People and channel matching and ranking         | `hooks/use-directory-search.ts`         |
| Loading, empty and error states                 | `components/search-list.tsx`            |

## Rules

- **A request needs something the user asked for.** Text or a filter they
  picked. A locked scope and the "Only my channels" toggle narrow a request but
  never start one.
- **DMs and Channels never send a request.** The backend has no suggestion
  endpoint; those lists come from synced state and work offline.
- **A locked scope replaces `in:` filters.** The backend ORs `in` ids, so adding
  the scope to them would let a typed `in:` escape the conversation.
- **Suggestions replace results** while a `from:` / `in:` operator is being
  typed. Picking one adds the filter and removes the operator from the field.

## Do not break

Each of these fixed a bug users reported.

| Keep                                                   | Or this comes back                              |
| ------------------------------------------------------ | ----------------------------------------------- |
| Typed text stays in `SearchInput`'s local state        | Every keystroke re-renders the whole screen     |
| The debounce ceiling (`maxWaitMs`)                     | Continuous typing never searches                |
| `SearchList` stays mounted while the query changes     | Keyboard handling is rebuilt per keystroke      |
| The query function passes `signal` to `apiGet`         | Superseded requests run to completion           |
| `applyWorkaroundForContentInsetHitTestBug` on the list | iOS: the list scrolls but rows cannot be tapped |

## Tests

```sh
npm run test:logic    # request rules, state, ranking, debounce, operators
npm run test:render   # search hook, input, results
```

Both live in `tests/unit/features/global-search/`.
