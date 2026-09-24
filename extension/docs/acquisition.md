# LinkedIn Acquisition Pipeline

**Category:** LinkedIn Acquisition  
**Last Updated:** Sep 24, 2026  
**Reading Time:** 10 min read  

The acquisition pipeline captures 1st-degree connections and relationship evidence while a user browses LinkedIn connections pages naturally.

> [!IMPORTANT]
> The acquisition engine relies on **20–25 second calm pacing intervals** between scroll batches to mirror authentic human browsing speeds.

---

## Key Pipeline Components

### 1. Zero-Click Page Detection
When a user navigates to `/mynetwork/invite-connect/connections/`, `content.js` detects the connections page context and automatically initializes the `ConnectionAcquisitionSession`.

### 2. Scroll Container Discovery
The engine dynamically discovers active scroll containers by inspecting element scroll dimensions, overflow properties, and loading sentinels (`.scaffold-finite-scroll__loader`).

### 3. Record Deduplication
Extracted connection cards pass through `getDeduplicationKey()`:
- Primary Key: Normalized profile URL (`url:https://www.linkedin.com/in/username`)
- Secondary Key: Provider/profile ID (`id:12345`)
- Fallback Key: Normalized person name (`name:john doe|`)

```js
// Example Canonical Deduplication Key
function canonicalConnectionKey(conn) {
  if (conn.profile_url) {
    const u = new URL(conn.profile_url);
    return u.pathname.replace(/\/$/, "").toLowerCase();
  }
  return (conn.name || "").toLowerCase().trim();
}
```

### 4. Non-Interruptive Visual Overlay
The `WarmGraphOverlay` renders a bottom-right floating status card observing session state:
- **PREPARING**: Page detection and initialization.
- **COLLECTING**: Active batch extraction with real-time count.
- **WAITING**: Waiting for next content batch to load.
- **SETTLING**: Verification phase checking duplicates and completion.
- **COMPLETED**: Displaying `[ Open My Network ]` CTA and sync status.

---

## Safety Guarantees

- **No CAPTCHA Evasion / Stealth Manipulation**: The system executes standard DOM reads without injecting hidden network requests or modifying browser fingerprints.
- **Background Persistence**: Closing the popup or switching browser tabs does not interrupt an active acquisition session.
