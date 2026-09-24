# LinkedIn Acquisition Pipeline

> [!IMPORTANT] 
> **Status:** Implemented (Production Pacing Pipelining)

The **WarmGraph Acquisition Pipeline** extracts high-fidelity relationship evidence from LinkedIn while maintaining a zero-footprint, non-interruptive user experience.

---

## ⚡ Pipeline Stages

The acquisition lifecycle processes profile evidence through four sequential stages:

1. **DOM Observation**: As the user naturally navigates LinkedIn, content scripts extract visible profile metadata, shared mutual connections, and interaction history.
2. **Pacing Queue**: Extracted data payloads pass through a **20–25 second pacing queue** managed by `AcquisitionSessionManager`.
3. **Deduplication & Settling**: Duplicate profile handles are resolved using normalized canonical URLs and unique profile IDs.
4. **Storage Commit**: Cleaned metadata is committed to local browser storage for graph weight calculations.

---

## ⏱️ Human Pacing Protocol Specification

To preserve account safety and mirror human interaction patterns, acquisition sessions enforce strict constraints:

```javascript
// WarmGraph Pacing Engine Constraints
const ACQUISITION_PACING = {
  MIN_INTERVAL_MS: 20000, // 20 seconds minimum interval
  MAX_INTERVAL_MS: 25000, // 25 seconds maximum interval
  JITTER_FACTOR: 0.15,    // Gaussian jitter to simulate human delay
  BURST_CAP: 1,           // Strictly 1 acquisition action per window
};
```

---

## 🛡️ Non-Interruptive Visual Overlay Protocol

The acquisition overlay provides non-intrusive status updates during network observation:

- **PREPARING**: WarmGraph initializes observation state (`"Warming relationship context..."`).
- **COLLECTING**: Extracted connection metrics are updated dynamically (`"Collected 48 relationship signals..."`).
- **WAITING**: Human pacing buffer active (`"Pacing network requests..."`).
- **SETTLING**: Finalizing graph weights (`"Refining relationship graph..."`).
- **COMPLETED**: Network session complete (`"Relationship graph updated."`).

> [!TIP]
> The overlay can be minimized or dismissed at any time without interrupting background session progress.
