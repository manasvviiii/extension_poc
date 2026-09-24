# WarmGraph High-Level Architecture

> [!NOTE] 
> **Status:** Implemented (v1.0 Core System Architecture)

WarmGraph is a client-first **relationship intelligence platform** designed for investment banking, private equity, and dealmaking professionals. 

---

## 🏛️ System Overview

The platform operates on a decoupled architecture separating passive browser observation, local relationship graph generation, and internal developer quality assurance tools.

```
┌─────────────────────────────────────────────────────────────┐
│                 Browser User Interface                       │
│  ┌──────────────────────┐      ┌─────────────────────────┐  │
│  │  LinkedIn Context    │      │ Non-Interruptive        │  │
│  │  (Normal Browsing)   │─────►│ Acquisition Overlay     │  │
│  └──────────────────────┘      └─────────────────────────┘  │
└────────────────────────────────────────┬────────────────────┘
                                         │ 20-25s Paced Sessions
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Local Chrome Storage                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Raw Connections • DOM Evidence • Profiles • Sessions   │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────────────────────┬────────────────────┘
                                         │ Client-Side Mapping
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   WarmGraph Engine                          │
│  ┌──────────────────────┐      ┌─────────────────────────┐  │
│  │ Weighted Dijkstra    │      │ Multi-Hop Path          │  │
│  │ Graph Engine         │─────►│ Recommendation Engine   │  │
│  └──────────────────────┘      └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 Core Architectural Pillars

### 1. Client-First Privacy & Zero-Knowledge Isolation
- Raw network connections, profile metadata, and deal evidence remain strictly inside the local Chrome extension storage.
- No private network metadata is transmitted to external servers without explicit user consent.

### 2. Human-Paced Passive Observation Engine
- Operates on a strict **20–25 second interval pacing protocol**.
- Avoids burst requests, rate limits, or automated bot detection flags on LinkedIn.

### 3. Decoupled State & UI Layer
- The visual overlay observes session state reactively without controlling or altering background acquisition logic.
- Background session lifecycle guarantees data persistence even if browser tabs are closed.

---

## 📊 Component Implementation Matrix

| Component | Layer | Purpose | Implementation Status |
| :--- | :--- | :--- | :--- |
| **Acquisition Engine** | Background Service Worker | Passive DOM extraction & session pacing | Implemented |
| **State Overlay** | Content Script DOM | Human-friendly visual status feedback | Implemented |
| **Graph Service** | Extension Core / Backend | Dijkstra-weighted shortest path calculations | Implemented |
| **Developer Dashboard** | Extension Internal Page | Extraction verification & QA inspection console | Implemented |
| **Public SaaS Portal** | Independent Website | Public product identity & Knowledge Hub | Implemented |
