# WarmGraph LinkedIn People Search Audit

## Scope and inspected files

- `extension/manifest.json` — MV3 entry points, permissions, host/content-script scope.
- `extension/content.js` — extraction, page scans, pagination detection/navigation, session lifecycle, persistence, backend import, SPA observers.
- `extension/background.js` — service worker message routing and acquisition-session persistence/cache.
- `extension/overlay.js` — floating status renderer and `currentSession` storage subscription.
- `extension/popup.js` — popup status reads and messages sent to active tab/background.
- `extension/auth.js` and `extension/cloud_sync.js` — extension auth/cloud helpers; no People Search pagination ownership.
- `extension/test_automated_acquisition.js`, `extension/test_overlay_acquisition.js`, `extension/test_real_batch_extraction.js`, and pagination-related `scratch/test_task_135*.js` — existing acquisition, rendering, and pagination assertions reviewed for dependencies.

There is no separate storage/session utility module. Session persistence is implemented in `ConnectionAcquisitionSession` in `content.js` and mirrored by `background.js`.

## 1. Architecture map

### Acquisition lifecycle

1. The MV3 content script loads `overlay.js`, then `content.js` on LinkedIn (`manifest.json`, `document_idle`).
2. `handlePeopleSearchUrlChange()` observes SPA URL changes through a mutation observer and a one-second poll. Once People Search results and the selected degree filter are ready, it calls `acquisitionSession.start("acquiring")`.
3. `start()` prevents duplicate loops and starts `runAcquisitionLoop()` on the singleton `acquisitionSession`.
4. The loop waits for People Search cards, calls `scanCurrentPageForUnseen()`, waits for a stable/empty result set, and performs a confirmation scan.
5. After page extraction, the loop calls `extractPaginationStateFromDom()`. `hasNext` selects `autoAdvanceToNextPage()`; false selects `finalizeAndSync()`.
6. `finalizeAndSync()` sets the completed/resting status and invokes the existing backend import path once the last page is reached.

### Session state machine

The relevant transitions are `acquiring → navigating → acquiring` for non-final People Search pages, and `acquiring → resting/completed` via `finalizeAndSync()` at the end. `autoAdvanceToNextPage()` owns the navigation transitions and checkpoints them. `runAcquisitionLoop()` owns the final-page decision. `start()` guards against an already-running singleton session.

### SPA navigation flow

`handlePeopleSearchUrlChange()` detects route/query changes, waits for result cards, and starts the shared session. During automatic pagination, `autoAdvanceToNextPage()` clicks the live Next control and awaits `waitForNewPageRender()`. That helper checks the `page` query parameter, first result-profile URL, and active pagination number, polling every 150 ms with an eight-second cap. The loop then continues against the new URL without constructing a new session.

### Overlay update flow

`checkpointSessionSync()` builds canonical `currentSession` and legacy `acquisition_session` objects and writes them to `chrome.storage.local`; it also calls `window.updateWarmGraphOverlay()`. `overlay.js` subscribes to `currentSession` storage updates and renders the state. During navigation, content reports the `navigating` state; after navigation it reports `acquiring`.

### Storage and backend flow

- Content is the session payload writer: it persists `currentSession`, `acquisition_session`, staging/active graph data, and the sync journal.
- Background listens for session updates, caches the legacy payload, merges status into storage, and responds to popup/content messages.
- Popup reads session status from storage/background and sends actions to the active tab; it does not own extraction or pagination.
- On finalization only, content uses the existing `/network/import` request. This audit/fix does not change its payload or backend behavior.

## 2. Function dependency graph

| Function | File / line | Callers | Important callees |
| --- | --- | --- | --- |
| `runAcquisitionLoop` | `extension/content.js:3122` | `ConnectionAcquisitionSession.start` (`:3676`) | `waitForPeopleCards`, `scanCurrentPageForUnseen`, `extractPaginationStateFromDom`, `autoAdvanceToNextPage`, `finalizeAndSync`, `checkpointSession` |
| `autoAdvanceToNextPage` | `extension/content.js:746` | `runAcquisitionLoop` (`:3454`) | `findEnabledPeopleSearchNextButton`, `extractPaginationStateFromDom`, `waitHumanActionDelay`, `waitForNewPageRender`, `waitForPeopleCards`, `checkpointSessionSync` |
| `waitForNewPageRender` | `extension/content.js:414` | `autoAdvanceToNextPage` (`:796`) | `getPeopleSearchProfileUrls`, `extractPaginationStateFromDom`, `MutationObserver`, interval polling |
| `findEnabledPeopleSearchNextButton` | `extension/content.js:697` | `extractPaginationStateFromDom`, `autoAdvanceToNextPage`, `syncFinishButtonVisibility`, `RUN_NEXT_BATCH` message handler, pagination decision diagnostic log | DOM queries within `.artdeco-pagination` or `nav[aria-label*="Pagination"]`; disabled/ancestor checks |
| `extractPaginationStateFromDom` | `extension/content.js:847` | `waitForNewPageRender`, `navigateToNextPageAndWait`, `autoAdvanceToNextPage`, `checkpointSessionSync`, `syncFinishButtonVisibility`, `getStatus`, `runAcquisitionLoop` | pagination container query, visible active/numbered-page parsing, `findEnabledPeopleSearchNextButton` |
| `scanCurrentPageForUnseen` | `extension/content.js:2604` | `runAcquisitionLoop` (initial and confirmation scans), `scanCurrentPage`, overlay action, collection/message handlers, sync-again flow | card/profile parsers, deduplication, enrichment and record stores |
| `finalizeAndSync` | `extension/content.js:3084` | `runAcquisitionLoop` final-page branch (`:3465`, Connections branch `:3477`) | `checkpointSession`, `autoSyncToBackend` |

Popup/background callers are indirect: popup sends start/sync/status actions; background routes them to the content script. Neither independently advances People Search pages.

## 3. Root-cause analysis

### Traced failure path

The current Next finder at `content.js:697` accepts either `.artdeco-pagination` or `nav[aria-label*="Pagination"]`. However, `extractPaginationStateFromDom()` at `:847` queries only `.artdeco-pagination`. It sets `hasNext` by calling the finder only inside `if (container)`. Therefore, when LinkedIn renders the pagination under its `<nav>` fallback, or replaces `.artdeco-pagination` during an SPA render, the state parser never calls the finder and returns its default `hasNext: false` even though an enabled Next control is present.

The loop at `:3434` finalizes whenever `pageState.hasNext` is false. Thus the concrete execution is:

`Page 1 extraction and confirmation scan complete → parser misses its pagination container → pageState.hasNext remains false → loop enters “Final page reached” → finalizeAndSync()`.

The opposite fallback already exists in the Next finder, and `autoAdvanceToNextPage()` already re-queries Next after its action delay. The stale `isKnownLastPage` gate was removed earlier; the current loop uses the live `pageState.hasNext` decision, so stale `totalPages` is not the stopping condition now. Session start guards and SPA observers do not cause this particular premature finalization path.

The code trace identifies a deterministic container mismatch. The exact runtime trigger is the parser seeing only the `<nav>` form or a transient replacement state; this explanation follows directly from its conditional query and default result, rather than from an unobserved backend/session failure.

## 4. Risk assessment

The fix affects only pagination-state discovery in `extractPaginationStateFromDom()`. Accepting the same `<nav>` fallback as the button finder may expose a disabled Next control, but `findEnabledPeopleSearchNextButton()` already checks the button and its ancestors before returning a control. It does not change profile scanning, session ownership/transitions, click timing, the wait helper, storage schemas, overlay code, popup behavior, or backend import.

## Fix plan

Make `extractPaginationStateFromDom()` query `.artdeco-pagination` and then the same pagination `<nav>` fallback used by the Next finder. Keep active-page/number parsing, enabled-Next detection, state transitions, and finalization unchanged.

## Implementation and validation

- Implemented the matching `<nav aria-label="Pagination">` fallback in `extractPaginationStateFromDom()`; no other behavior was changed for this fix.
- `node --check extension/content.js` passed.
- A focused mock-DOM check with no `.artdeco-pagination`, a pagination `<nav>`, active page 1, page numbers 1–5, and an enabled Next control returned `{ currentPage: 1, totalPages: 5, hasNext: true }`.
- Existing `scratch/test_task_13512.js` did not pass as a runtime test: it asserts an obsolete `waitForNewPageRender` timeout fallback and its VM sandbox does not define the global `location` used by the current content script. Its first two static pagination-flow assertions passed. The test and unrelated code were left unchanged.
- A real LinkedIn four-page crawl was not run in this environment. The successful-run logs should show `pageState.hasNext: true`, `[WarmGraph] Advancing to Page 2` (then 3 and 4), active `acquiring → navigating → acquiring` transitions for each advance, and `[WarmGraph] Final page reached` followed by one `finalizeAndSync()` on Page 4.
