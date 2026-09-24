# WarmGraph Architecture

**Category:** Architecture  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 8 min read  

WarmGraph is a warm-introduction network platform engineered to extract relationship evidence rendered on LinkedIn and build weighted professional relationship graphs.

> [!NOTE]
> WarmGraph operates on a **client-side passive observation model**. It reads relationship evidence rendered in a user's browser without scraping, API manipulation, or stealth automation.

---

## High-Level System Overview

The system consists of three distinct layers:

1. **Browser Extension (Client Layer)**:
   - `content.js`: Executes DOM extraction, scroll container inspection, and local deduplication.
   - `overlay.js`: Renders the non-interruptive floating UI status card.
   - `background.js`: Maintains persistent acquisition session state across tab navigation.
   - `popup.js`: Compact extension popup interface.
   - `developer_dashboard.html`: Read-only internal QA console for inspecting extracted datasets.
   - `knowledge_hub.html`: Internal documentation portal.

2. **Backend Services (API Layer)**:
   - FastAPI REST backend serving `/network/import`, `/network/{owner_id}`, and warm path scoring endpoints.
   - Tenant isolation & authentication dependencies enforcing strict `owner_id` context boundaries.

3. **Data & Storage Layer**:
   - `chrome.storage.local`: Persistent extension storage for local acquisition sessions.
   - PostgreSQL / JSON Snapshot Repositories: Persistent relationship graph snapshots.

---

## Acquisition & Data Flow

```
LinkedIn Page DOM
       │
       ▼
content.js (DOM Extraction & Deduplication)
       │
       ├─► overlay.js (Live Status Overlay)
       │
       ▼
background.js (AcquisitionSessionManager in chrome.storage.local)
       │
       ▼
FastAPI Backend (/network/import)
       │
       ▼
NetworkX Graph Service (Weighted Relationship Graph)
```

---

## Core Engineering Directives

- **Non-Interruptive Overlay**: Acquisition progress is observed cleanly without blocking user browsing.
- **Tenant Isolation**: Every network record and relationship edge is bound strictly to `owner_id`.
- **Deduplication First**: Records are deduplicated deterministically by normalized profile URL and person name before storage or backend synchronization.
