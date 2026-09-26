const DEV_MODE = false;

let connectionsState = null;
let acquisitionState = null;
let targetSearchState = null;
let selectedTargetState = null;
let warmPathState = null;
let explainPathState = null;

let latestData = null;

const BACKEND_BASE_URL =
  "http://127.0.0.1:8000";

const output =
  document.getElementById("output");
const targetSearchResultsEl =
  document.getElementById("targetSearchResults");
const selectedTargetBadgeEl =
  document.getElementById("selectedTargetBadge");
const pathResultsEl =
  document.getElementById("pathResults");


/* =========================================================
   OWNER IDENTITY
========================================================= */

/**
 * Read the canonical owner identity.
 * Priority: warmgraph_owner.ownerId > ownerId (only if not a random warmgraph_ UUID)
 * Never generates a new ID — popup.js is read-only for identity.
 */
function getStoredOwnerId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["warmgraph_owner", "ownerId", "externalProfileUrl"],
      (result) => {
        // Priority 1: canonical warmgraph_owner record
        const owner = result.warmgraph_owner;
        if (owner?.ownerId) {
          resolve({
            ownerId: owner.ownerId,
            externalProfileUrl: owner.profileUrl || result.externalProfileUrl || null,
            name: owner.name || null
          });
          return;
        }

        // Priority 2: legacy ownerId (only if not a random warmgraph_ UUID)
        const legacyId = result.ownerId;
        if (legacyId && !legacyId.startsWith("warmgraph_")) {
          resolve({
            ownerId: legacyId,
            externalProfileUrl: result.externalProfileUrl || null,
            name: null
          });
          return;
        }

        // Not yet identified — return null so callers show "Identity Pending"
        resolve({ ownerId: null, externalProfileUrl: result.externalProfileUrl || null, name: null });
      }
    );
  });
}

function getInitials(name) {
  if (!name || typeof name !== "string") return "WG";
  const clean = name.replace(/^https?:\/\/[^/]+\/in\//i, "").replace(/-/g, " ").trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initTabNavigation() {
  const tabs = [
    { btn: "tabBtnOverview", panel: "tabPanelOverview" },
    { btn: "tabBtnSearch", panel: "tabPanelSearch" },
    { btn: "tabBtnWarmPath", panel: "tabPanelWarmPath" },
    { btn: "tabBtnGraph", panel: "tabPanelGraph" }
  ];

  tabs.forEach(tab => {
    const btnEl = document.getElementById(tab.btn);
    const panelEl = document.getElementById(tab.panel);
    if (btnEl && panelEl) {
      btnEl.addEventListener("click", () => {
        tabs.forEach(t => {
          document.getElementById(t.btn)?.classList.remove("active");
          document.getElementById(t.panel)?.classList.remove("active");
        });
        btnEl.classList.add("active");
        panelEl.classList.add("active");
      });
    }
  });
}

function initCommandSearch() {
  const commandInput = document.getElementById("commandSearchInput");
  const companyInput = document.getElementById("company");
  const roleInput = document.getElementById("targetRole");
  const searchBtn = document.getElementById("searchTarget");

  if (!commandInput) return;

  commandInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (companyInput) companyInput.value = val;
    if (roleInput) roleInput.value = val;

    if (val.length > 2 && searchBtn) {
      searchBtn.click();
    }
  });

  commandInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchBtn) {
      searchBtn.click();
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initTabNavigation();
      initCommandSearch();
    });
  } else {
    initTabNavigation();
    initCommandSearch();
  }
}



/* =========================================================
   SHOW DETECTED IDENTITY
========================================================= */

/**
 * Render identity banner with the detected owner.
 */
function renderIdentityReady(ownerId, profileUrl) {
  const identityEl = document.getElementById("identity");
  if (!identityEl) return;
  identityEl.className = "detected";
  identityEl.textContent = `Identity Ready ✓${profileUrl ? " (" + profileUrl + ")" : ""}`;
}

function renderIdentityPending() {
  const identityEl = document.getElementById("identity");
  if (!identityEl) return;
  identityEl.className = "pending";
  identityEl.textContent = "Identity Pending — Open any LinkedIn page to connect owner ID.";
}

(async () => {
  // Step 1: check chrome.storage.local for warmgraph_owner (canonical key)
  const identity = await getStoredOwnerId();

  if (identity.ownerId) {
    renderIdentityReady(identity.ownerId, identity.externalProfileUrl);
    return;
  }

  // Step 2: storage empty — show "detecting..." and query all LinkedIn tabs
  const identityEl = document.getElementById("identity");
  if (identityEl) {
    identityEl.className = "pending";
    identityEl.textContent = "Detecting identity…";
  }

  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      // Find all LinkedIn tabs (any page — Feed, Connections, Profile, Search)
      const tabs = await new Promise(resolve =>
        chrome.tabs.query({ url: "*://*.linkedin.com/*" }, resolve)
      );

      if (!tabs || tabs.length === 0) {
        // No LinkedIn tab open at all
        renderIdentityPending();
        return;
      }

      // Ask each tab for identity — first successful response wins
      let resolved = false;
      const tryTab = (tab) => new Promise(resolve => {
        try {
          chrome.tabs.sendMessage(tab.id, { action: "GET_OWNER_IDENTITY" }, (res) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve(res);
          });
        } catch (_) {
          resolve(null);
        }
      });

      const results = await Promise.all(tabs.map(tryTab));
      for (const res of results) {
        if (res && res.success && res.ownerId) {
          resolved = true;
          renderIdentityReady(res.ownerId, res.profileUrl);
          break;
        }
      }

      if (!resolved) {
        // Tabs exist but content script hasn't detected identity yet
        // (e.g., freshly opened tab, nav not rendered)
        renderIdentityPending();
      }
    } else {
      renderIdentityPending();
    }
  } catch (_) {
    renderIdentityPending();
  }
})();


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


/* =========================================================
   EXTRACTION PREVIEW
========================================================= */

function renderExtractionPreview(response, filterQuery) {
  if (!response) return;
  connectionsState = response;
  latestData = response;

  let connections = response.connections || [];
  const evidence = response.relationship_evidence || [];

  console.log("[EXTRACTION PREVIEW]", {
    connectionsCount: connections.length,
    previewRendered: true
  });

  const searchVal = filterQuery !== undefined 
    ? filterQuery 
    : (document.getElementById("searchConnectionsInput")?.value || "");

  const query = searchVal.toLowerCase().trim();
  if (query) {
    connections = connections.filter(c => {
      const name = (c.name || "").toLowerCase();
      const headline = (c.headline || c.occupation || "").toLowerCase();
      const degree = (c.degree || "").toLowerCase();
      return name.includes(query) || headline.includes(query) || degree.includes(query);
    });
  }

  const firstDegreeCount = response.first_degree_count !== undefined ? response.first_degree_count : (response.connections ? response.connections.length : 0);
  const evidenceCount = response.relationship_evidence_count !== undefined ? response.relationship_evidence_count : evidence.length;

  let html = `
    <div class="summary">
      <div class="summary-card">
        <span class="summary-number">
          ${firstDegreeCount}
        </span>
        <span class="summary-label">
          1st-degree
        </span>
      </div>

      <div class="summary-card">
        <span class="summary-number">
          ${evidenceCount}
        </span>
        <span class="summary-label">
          Evidence
        </span>
      </div>
    </div>
  `;

  if (connections.length > 0) {
    html += `
      <div class="section-title">
        Your Connections ${query ? `(Filtered: ${connections.length})` : ""}
      </div>
    `;

    connections.forEach((person) => {
      const pName = person.name || "Unknown person";
      html += `
        <div class="record">
          <div class="record-header">
            <div class="avatar-circle">${escapeHtml(getInitials(pName))}</div>
            <div>
              <div class="record-name">${escapeHtml(pName)}</div>
              <div class="record-headline">${escapeHtml(person.headline || person.occupation || "No headline available")}</div>
            </div>
          </div>

          <div class="record-meta">
            <span class="badge">
              ${escapeHtml(person.degree || "1st")}
            </span>
            ${person.connection_date ? `<span class="badge">Connected ${escapeHtml(person.connection_date)}</span>` : ""}
          </div>

          ${person.profile_url ? `
            <a class="record-link" href="${escapeHtml(person.profile_url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(person.profile_url)}
            </a>
          ` : ""}
        </div>
      `;
    });
  } else if (query) {
    html += `
      <div class="status-box empty">
        No connections found matching "${escapeHtml(query)}".
      </div>
    `;
  }

  if (evidence.length > 0) {
    html += `
      <div class="section-title" style="margin-top:14px;">
        Relationship Evidence
      </div>
    `;

    evidence.forEach((item) => {
      const mutualNames = Array.isArray(item.mutual_connection_names) ? item.mutual_connection_names : [];
      html += `
        <div class="record">
          <div class="record-name">
            ${escapeHtml(item.name || "Unknown person")}
          </div>

          <div class="record-headline">
            ${escapeHtml(item.headline || "No headline available")}
          </div>

          <div class="record-meta">
            <span class="badge">
              ${escapeHtml(item.observed_degree || "2nd")}
            </span>
            <span class="badge">
              ${escapeHtml(item.evidence_type || "relationship")}
            </span>
          </div>

          ${item.mutual_connections_text ? `<div class="mutual"><strong>Mutual:</strong> ${escapeHtml(item.mutual_connections_text)}</div>` : ""}
          ${mutualNames.length > 0 ? `<div class="mutual"><strong>Connections:</strong> ${escapeHtml(mutualNames.join(", "))}</div>` : ""}
          ${item.location ? `<div class="mutual"><strong>Location:</strong> ${escapeHtml(item.location)}</div>` : ""}
          ${item.followers ? `<div class="mutual"><strong>Followers:</strong> ${escapeHtml(item.followers)}</div>` : ""}
          ${item.profile_url ? `<a class="record-link" href="${escapeHtml(item.profile_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.profile_url)}</a>` : ""}
        </div>
      `;
    });
  }

  if (connections.length === 0 && evidence.length === 0 && !query) {
    html += `
      <div class="status-box empty">
        No relationship data found on this page.
      </div>
    `;
  }

  const outputEl = document.getElementById("output");
  if (outputEl) {
    outputEl.innerHTML = html;
  }
}


/* =========================================================
   AUTOMATED CONNECTION ACQUISITION (PASSIVE MONITORING)
========================================================= */

const acquisitionContainer = document.getElementById("acquisitionContainer");
const acquisitionStatusTitle = document.getElementById("acquisitionStatusTitle");
const acquisitionInstruction = document.getElementById("acquisitionInstruction");
const acquisitionExpectedEl = document.getElementById("acquisitionExpected");
const acquisitionCountEl = document.getElementById("acquisitionCount");
const acquisitionRemainingEl = document.getElementById("acquisitionRemaining");
const acquisitionEvidenceCountEl = document.getElementById("acquisitionEvidenceCount");
const syncStatusBadgeEl = document.getElementById("syncStatusBadge");

let statusPollInterval = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendTabMessage(action, payload = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        return reject(new Error("No active tab found. Please open a LinkedIn page or mock connections page."));
      }
      chrome.tabs.sendMessage(tab.id, { action, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error("Could not connect to page context. Make sure you are on LinkedIn or synthetic test page."));
        }
        if (!response) {
          return reject(new Error("No response from page."));
        }
        if (!response.success) {
          return reject(new Error(response.error || "Action failed."));
        }
        resolve(response);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function getHumanizedStateInfo(status) {
  if (!status) {
    return {
      title: "Reading your network",
      badgeText: "● Reading",
      subtext: "WarmGraph is getting ready to discover your network.",
      isComplete: false,
      isSyncing: false,
      isSyncFailed: false
    };
  }

  const state = status.state || "idle";
  const syncStatus = status.sync_status || status.syncStatus || "idle";
  const collected = status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0);
  const expected = status.expected_total || status.reliable_dom_total || 0;
  const countdown = status.countdown_seconds || status.countdownSeconds || 0;
  const isError = state === "failed" || state === "error" || (status.error && status.error.length > 0);

  if (isError) {
    return {
      title: "Sync Failed",
      badgeText: "⚠️ Sync Failed",
      subtext: status.error || status.status_message || "An unexpected issue occurred. Try reopening your LinkedIn Connections page.",
      isComplete: false,
      isSyncing: false,
      isSyncFailed: true
    };
  }

  if (syncStatus === "synced") {
    return {
      title: "Network Successfully Synced",
      badgeText: "✓ Synced",
      subtext: `${collected} connections imported\nRelationship graph ready`,
      isComplete: true,
      isSyncing: false,
      isSyncFailed: false
    };
  }

  if (syncStatus === "syncing") {
    return {
      title: "Importing your network...",
      badgeText: "● Syncing",
      subtext: `Saving ${collected} connections to WarmGraph...`,
      isComplete: false,
      isSyncing: true,
      isSyncFailed: false
    };
  }

  if (syncStatus === "failed" || syncStatus === "sync_failed") {
    return {
      title: "Sync Failed",
      badgeText: "⚠️ Sync Failed",
      subtext: "We couldn't finish saving your network yet. Click Sync Network to try again.",
      isComplete: false,
      isSyncing: false,
      isSyncFailed: true
    };
  }

  switch (state) {
    case "preparing":
      return {
        title: "Reading your network",
        badgeText: "● Reading",
        subtext: "WarmGraph is reading your LinkedIn network page.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "acquiring":
    case "collecting":
    case "resumed":
      return {
        title: "Building your relationship graph",
        badgeText: "● Building graph",
        subtext: "Discovering your connections in the background.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "waiting":
    case "waiting_for_content":
      return {
        title: countdown > 0 ? `Next batch in ${countdown}s` : "Preparing next batch...",
        badgeText: "⏳ Batch Countdown",
        subtext: "You can continue browsing LinkedIn normally.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "settling":
    case "verifying":
      return {
        title: "Checking remaining connections",
        badgeText: "● Verifying",
        subtext: "Checking if more connections remain.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "completed":
    case "resting":
      return {
        title: "You're all caught up ✨",
        badgeText: "Resting",
        subtext: "No new connections found. Your network is fully synced.",
        isComplete: true,
        isSyncing: false,
        isSyncFailed: false
      };

    case "paused":
    case "interrupted":
      return {
        title: "We'll continue when you're back",
        badgeText: "🟠 Paused",
        subtext: "Return to Connections to continue syncing.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "idle":
    default:
      if (collected > 0 && (status.completion_status === "complete" || status.completionStatus === "complete" || state === "resting" || state === "completed")) {
        return {
          title: "You're all caught up ✨",
          badgeText: "Resting",
          subtext: "No new connections found. Your network is fully synced.",
          isComplete: true,
          isSyncing: false,
          isSyncFailed: false
        };
      }
      return {
        title: "Reading your network",
        badgeText: "● Ready",
        subtext: "Open your LinkedIn Connections page to build your relationship graph.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };
  }
}

function updateAcquisitionDashboard(status) {
  if (!status) return;

  // ── SSOT: popup.js is a PURE RENDERER ─────────────────────────────────
  // Trust ALL values written by content.js to currentSession.
  // NEVER recalculate actualProfiles or progressPercent here.
  // ────────────────────────────────────────────────────────────────────────
  const rawState = status.state || "idle";
  const extracted = status.extractedConnections !== undefined
    ? status.extractedConnections
    : (status.collected_count !== undefined ? status.collected_count : 0);

  // Trust actualProfiles from content.js — NEVER re-derive from extracted
  const actual = status.actualProfiles !== undefined && status.actualProfiles > 0
    ? status.actualProfiles
    : (status.totalConnections || status.expected_total || 0);

  const total = status.totalConnections !== undefined ? status.totalConnections : (status.expected_total || actual);

  // Trust state directly from content.js — do NOT re-map completed→resting here
  const state = rawState;
  // Trust progressPercent from content.js; fallback-compute only if absent
  const progressPercent = status.progressPercent !== undefined
    ? status.progressPercent
    : (actual > 0 ? (extracted >= actual ? 100 : Math.min(99, Math.floor((extracted / actual) * 100))) : (extracted > 0 ? 100 : 0));
  const syncState = status.syncStatus || status.sync_status || "idle";
  const lastSyncDate = status.lastSyncedAt || status.lastSyncDate || status.last_synced_at || "";
  const countdown = status.countdownSeconds !== undefined ? status.countdownSeconds : (status.countdown_seconds || 0);
  const activeFilter = status.active_filter || status.activeFilter;

  const currentSession = {
    sessionId: status.sessionId || null,
    totalConnections: total,
    actualProfiles: actual,
    extractedConnections: extracted,
    progressPercent: progressPercent,
    syncStatus: syncState,
    lastSyncDate: lastSyncDate,
    state: state
  };

  const heroDisplayEl = document.getElementById("heroCountDisplay");
  const heroLabelEl = document.getElementById("heroCountLabel");
  const heroSecondaryEl = document.getElementById("heroSecondaryText");
  const statusBadgeEl = document.getElementById("acquisitionStatusBadge");

  const activeFilterContainerEl = document.getElementById("activeFilterContainer");
  const activeFilterTextEl = document.getElementById("activeFilterText");
  const countdownTextEl = document.getElementById("batchCountdownText");

  const titleEl = document.getElementById("acquisitionStatusTitle");
  const countDisplayEl = document.getElementById("acquisitionCountDisplay");
  const instructionEl = document.getElementById("acquisitionInstruction");
  const syncBadgeEl = document.getElementById("syncStatusBadge");
  const progressBarEl = document.getElementById("acquisitionProgressBar");
  const remainingEl = document.getElementById("acquisitionRemainingText");
  const syncAgainBtn = document.getElementById("syncAgainBtn") || document.getElementById("syncNetworkBtn");
  const ctaSectionEl = document.getElementById("networkReadyCtaSection");
  const ctaBtnEl = document.getElementById("openWarmGraphWorkspaceBtn");

  const syncSuccessScreenEl = document.getElementById("syncSuccessScreen");
  const syncedCountSubtextEl = document.getElementById("syncedCountSubtext");
  const lastSyncedTimestampTextEl = document.getElementById("lastSyncedTimestampText");
  const successContinueBtn = document.getElementById("successContinueToResearchBtn");

  const humanized = getHumanizedStateInfo(currentSession);

  // Active Filter display (PART 4)
  if (activeFilterContainerEl && activeFilterTextEl) {
    if (activeFilter) {
      const filterLabelStr = typeof activeFilter === "object" ? (activeFilter.label || activeFilter.category || "Filter Active") : String(activeFilter);
      activeFilterTextEl.textContent = filterLabelStr;
      activeFilterContainerEl.style.display = "block";
    } else {
      activeFilterContainerEl.style.display = "none";
    }
  }

  if (state === "resting" || (actual > 0 && extracted === actual)) {
    if (heroDisplayEl) heroDisplayEl.textContent = `${extracted} / ${actual} mapped`;
    if (heroLabelEl) heroLabelEl.textContent = `(100%)`;
    if (heroSecondaryEl) heroSecondaryEl.textContent = `All LinkedIn connections mapped`;
    if (countDisplayEl) countDisplayEl.textContent = `${extracted} / ${actual} mapped`;
    if (instructionEl) instructionEl.textContent = `No new connections found. Your network is fully synced.`;
  } else if (actual > 0) {
    if (heroDisplayEl) heroDisplayEl.textContent = `${extracted} / ${actual} mapped`;
    if (heroLabelEl) heroLabelEl.textContent = `(${progressPercent}%)`;
    if (heroSecondaryEl) heroSecondaryEl.textContent = `${extracted} of ${actual} connections catalogued`;
    if (countDisplayEl) countDisplayEl.textContent = `${extracted} of ${actual} connections`;
    if (instructionEl) instructionEl.textContent = humanized.subtext;
  } else {
    if (heroDisplayEl) heroDisplayEl.textContent = `${extracted} Connections Mapped`;
    if (heroLabelEl) heroLabelEl.textContent = extracted === 1 ? "connection" : "connections";
    if (heroSecondaryEl) heroSecondaryEl.textContent = `${extracted} connections discovered`;
    if (countDisplayEl) countDisplayEl.textContent = `${extracted} connections found`;
    if (instructionEl) instructionEl.textContent = humanized.subtext;
  }

  if (statusBadgeEl) {
    statusBadgeEl.textContent = humanized.badgeText;
  }

  if (titleEl) {
    titleEl.textContent = humanized.title;
  }

  // Batch Countdown display (PART 3)
  if (countdownTextEl) {
    if ((state === "waiting" || countdown > 0) && state !== "paused" && state !== "interrupted") {
      countdownTextEl.textContent = `Next batch in ${countdown}s`;
      countdownTextEl.style.display = "block";
    } else {
      countdownTextEl.style.display = "none";
    }
  }

  if (progressBarEl) {
    progressBarEl.style.width = `${progressPercent}%`;
  }

  if (remainingEl) {
    if (state === "resting" || extracted === actual) {
      remainingEl.textContent = `All ${extracted} catalogued (100%)`;
    } else if (actual > 0) {
      const missing = Math.max(0, actual - extracted);
      remainingEl.textContent = `${missing} remaining (${progressPercent}%)`;
    } else {
      remainingEl.textContent = `${extracted} connections catalogued`;
    }
  }

  // Persistent Sync Success Screen (PART 5 & PART 6)
  if (syncSuccessScreenEl) {
    if (syncState === "synced" || state === "resting" || (actual > 0 && extracted === actual)) {
      syncSuccessScreenEl.style.display = "block";
      const titleScreenEl = syncSuccessScreenEl.querySelector("div:nth-child(2)");
      if (titleScreenEl) titleScreenEl.textContent = "You're all caught up ✨";
      if (syncedCountSubtextEl) {
        syncedCountSubtextEl.textContent = `${extracted} connections synced`;
      }
      if (lastSyncedTimestampTextEl) {
        const timeStr = status.last_synced_at || status.lastSyncedAt || "Just now";
        lastSyncedTimestampTextEl.textContent = `Last synced: ${timeStr}`;
      }
    } else {
      syncSuccessScreenEl.style.display = "none";
    }
  }

  if (successContinueBtn && !successContinueBtn._hasInitListener) {
    successContinueBtn._hasInitListener = true;
    successContinueBtn.addEventListener("click", () => {
      const researchContainer = document.getElementById("researchContainer");
      if (researchContainer) {
        researchContainer.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  if (ctaSectionEl) {
    if (humanized.isComplete && syncState !== "synced") {
      ctaSectionEl.style.display = "block";
    } else {
      ctaSectionEl.style.display = "none";
    }
  }

  if (ctaBtnEl && !ctaBtnEl._hasInitListener) {
    ctaBtnEl._hasInitListener = true;
    ctaBtnEl.addEventListener("click", () => {
      const researchContainer = document.getElementById("researchContainer");
      if (researchContainer) {
        researchContainer.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  // Sync Again Button logic — ALWAYS visible & always dispatches SYNC_NETWORK
  if (syncAgainBtn) {
    syncAgainBtn.style.display = "inline-block";
    if (syncState === "syncing") {
      syncAgainBtn.disabled = true;
      syncAgainBtn.textContent = "Syncing...";
    } else {
      syncAgainBtn.disabled = false;
      syncAgainBtn.textContent = "Sync Again";
    }

    if (!syncAgainBtn._hasInitListener) {
      syncAgainBtn._hasInitListener = true;
      syncAgainBtn.addEventListener("click", async () => {
        console.log("[SYNC] Button clicked");
        syncAgainBtn.disabled = true;
        syncAgainBtn.textContent = "Syncing...";

        chrome.runtime.sendMessage({
          type: "SYNC_NETWORK",
          action: "SYNC_NETWORK"
        });
      });
    }
  }

  if (syncBadgeEl) {
    if (syncState === "synced") {
      syncBadgeEl.style.display = "inline";
      syncBadgeEl.innerHTML = `<span style="color:#2e7d32; font-weight:700;">✓ ${collected} connections synced</span>`;
    } else {
      syncBadgeEl.style.display = "none";
    }
  }

  // Live search listener on search input
  const searchInput = document.getElementById("searchConnectionsInput");
  if (searchInput && !searchInput._hasInitListener) {
    searchInput._hasInitListener = true;
    searchInput.addEventListener("input", (e) => {
      if (latestData) {
        renderExtractionPreview(latestData, e.target.value);
      }
    });
  }

  // Developer Extraction Dashboard & Diagnostics (Hidden when DEV_MODE = false)
  const devDashBtn = document.getElementById("openDevDashboardBtn");
  const toggleBtn = document.getElementById("toggleDebugTelemetryBtn");
  const diagEl = document.getElementById("telemetryDiagnostics");

  if (!DEV_MODE) {
    if (devDashBtn) devDashBtn.style.display = "none";
    if (toggleBtn) toggleBtn.style.display = "none";
    if (diagEl) diagEl.style.display = "none";
  } else {
    if (devDashBtn) devDashBtn.style.display = "inline-block";
    if (toggleBtn) toggleBtn.style.display = "inline-block";
  }

  if (DEV_MODE && devDashBtn && !devDashBtn._hasInitListener) {
    devDashBtn._hasInitListener = true;
    devDashBtn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "OPEN_MY_NETWORK" });
      } else if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL("developer_dashboard.html") });
      } else if (typeof window !== "undefined") {
        window.open("developer_dashboard.html", "_blank");
      }
    });
  }

  if (DEV_MODE && toggleBtn && !toggleBtn._hasInitListener) {
    toggleBtn._hasInitListener = true;
    toggleBtn.addEventListener("click", () => {
      if (diagEl.style.display === "none" || !diagEl.style.display) {
        diagEl.style.display = "block";
        toggleBtn.textContent = "[ Developer Diagnostics ▴ ]";
      } else {
        diagEl.style.display = "none";
        toggleBtn.textContent = "[ Developer Diagnostics ▾ ]";
      }
    });
  }

  if (diagEl) {
    getStoredOwnerId().then(idInfo => {
      let debugHead = `=== DEVELOPER DIAGNOSTICS ===\n` +
        `Owner ID: ${idInfo.ownerId || "Pending"}\n` +
        `LinkedIn Profile: ${idInfo.externalProfileUrl || "Not detected"}\n` +
        `Session ID: ${status.sessionId || "None"}\n` +
        `State: ${status.state || "idle"} | Completion Status: ${status.completion_status || "incomplete"}\n\n`;

      if (status.telemetry) {
        const t = status.telemetry;
        debugHead += `[EXTRACTION TELEMETRY]\n` +
          `Profile Links Found: ${t.dom_card_count || 0}\n` +
          `Containers Inspected: ${t.containers_inspected || 0}\n` +
          `Successfully Extracted: ${t.extracted_records || 0} | Failed: ${t.failed_extraction || 0}\n` +
          `Previously Known: ${t.previously_known || 0} | New Unique: +${t.new_unique || 0}\n` +
          `Total Collected: ${t.collected_total || 0}\n\n` +
          `[LAST ACTION]\n` +
          `Attempt: #${t.attempt_number || 1} | Method: ${t.trigger_method || "none"}\n` +
          `Target Container: ${t.scroll_container_description || "none"}\n` +
          `scrollTop: ${t.scroll_top_before || 0} → ${t.scroll_top_after || 0}\n` +
          (t.settling_phase_active ? `Settling Phase: ${t.settling_phase_active} | Progress: ${t.settling_progress_detected || "None"}\n` : "") +
          `\n`;

        if (t.bottom_telemetry) {
          const b = t.bottom_telemetry;
          let rectStr = b.loaderBoundingClientRect ? `[top:${b.loaderBoundingClientRect.top}, bot:${b.loaderBoundingClientRect.bottom}, w:${b.loaderBoundingClientRect.width}, h:${b.loaderBoundingClientRect.height}]` : "N/A";
          debugHead += `[BOTTOM CONTAINER DIAGNOSTIC]\n` +
            `scrollEventObserved: ${b.scrollEventObserved || "NO"} | target: ${b.scrollEventTarget || "None"}\n` +
            `scrollTop: ${b.scrollTop} | maxScrollTop: ${b.maxScrollTop} | distanceFromBottom: ${b.distanceFromBottom}px\n` +
            `scrollHeight: ${b.scrollHeightBefore || 0} → ${b.scrollHeightAfter || 0}\n` +
            `cardCount: ${b.cardCountBefore || 0} → ${b.cardCountAfter || 0} | profileLinks: ${b.profileLinkCountBefore || 0} → ${b.profileLinkCountAfter || 0}\n` +
            `mutationsObserved: ${b.mutationsObserved || "NO"} | newDomNodes: ${b.newDomNodes || "None"}\n` +
            `tempLoadingDetected: ${b.tempLoadingDetected || "None"}\n` +
            `loaderFound: ${b.loaderFound ? "YES" : "No"} | visibleInContainer: ${b.loaderVisibleInContainer ? "YES" : "No"}\n` +
            `loaderRect: ${rectStr}\n\n`;

          if (Array.isArray(b.elementsNearBottom) && b.elementsNearBottom.length > 0) {
            debugHead += `[ELEMENTS NEAR BOTTOM (${b.elementsNearBottom.length})]\n`;
            b.elementsNearBottom.forEach((elStr, idx) => {
              debugHead += `  ${idx + 1}. ${elStr}\n`;
            });
            debugHead += `\n`;
          }
        }
      }

      if (Array.isArray(status.container_diagnostics) && status.container_diagnostics.length > 0) {
        debugHead += `=== LIVE CONTAINER CANDIDATES (${status.container_diagnostics.length}) ===\n`;
        status.container_diagnostics.forEach((c, idx) => {
          debugHead += `[${idx + 1}] ${c.label}\n` +
            `    desc: ${c.description}\n` +
            `    scrollHeight: ${c.scrollHeight} | clientHeight: ${c.clientHeight} | scrollTop: ${c.scrollTop}\n` +
            `    overflowY: ${c.overflowY} | isScrollable: ${c.isScrollable ? "YES ★" : "No"}\n` +
            `    hasLoader: ${c.hasLoader ? "Yes" : "No"} | cardCount: ${c.cardCount}\n`;
        });
      }

      diagEl.textContent = debugHead;
    });
  }

  if (status.connections) {
    latestData = status;
    renderExtractionPreview(status);
  }
}

function fetchAcquisitionStatus() {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["acquisition_session", "currentSession"], (localRes) => {
        let localSession = (localRes && localRes.acquisition_session) || null;
        const currentSession = (localRes && localRes.currentSession) || null;

        if (currentSession) {
          if (!localSession) localSession = {};
          localSession = {
            ...localSession,
            extractedConnections: currentSession.extractedConnections !== undefined ? currentSession.extractedConnections : (localSession.extractedConnections || currentSession.actualProfiles || 0),
            collected_count: currentSession.actualProfiles !== undefined ? currentSession.actualProfiles : (localSession.collected_count || currentSession.extractedConnections || 0),
            totalConnections: currentSession.totalConnections !== undefined ? currentSession.totalConnections : localSession.totalConnections,
            expected_total: currentSession.totalConnections !== undefined ? currentSession.totalConnections : localSession.expected_total,
            lastSyncDate: currentSession.lastSyncDate || localSession.lastSyncDate || "Today"
          };
        }

        const finishWithStatus = (res) => {
          if (res && res.status && localSession) {
            if (localSession.syncStatus === "synced" || localSession.sync_status === "synced") {
              res.status.syncStatus = "synced";
              res.status.sync_status = "synced";
            }
          }
          resolve(res || (localSession ? { success: true, status: localSession } : null));
        };

        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "GET_SESSION_STATUS" }, (bgRes) => {
            if (!chrome.runtime.lastError && bgRes && bgRes.status && bgRes.status.state !== "idle") {
              return finishWithStatus(bgRes);
            }
            sendTabMessage("getAcquisitionStatus").then(tabRes => {
              finishWithStatus(tabRes);
            }).catch(() => {
              if (bgRes && bgRes.status) {
                finishWithStatus(bgRes);
              } else if (localSession) {
                finishWithStatus({ success: true, status: localSession });
              } else {
                resolve(null);
              }
            });
          });
        } else {
          sendTabMessage("getAcquisitionStatus").then(tabRes => finishWithStatus(tabRes)).catch(() => {
            if (localSession) finishWithStatus({ success: true, status: localSession });
            else resolve(null);
          });
        }
      });
    } else {
      resolve(null);
    }
  });
}

async function getActiveConnections() {
  if (typeof chrome === "undefined" || !chrome?.storage?.local) return [];
  const res = await new Promise(r => chrome.storage.local.get(
    ["warmgraph_active_graph", "stored_connections", "acquisition_session", "currentSession"],
    r
  ));

  const activeGraph = res?.warmgraph_active_graph;
  let connections = [];
  if (Array.isArray(activeGraph)) {
    connections = activeGraph;
  } else if (Array.isArray(activeGraph?.connections)) {
    connections = activeGraph.connections;
  }

  if (!connections || connections.length === 0) {
    if (res?.stored_connections && Array.isArray(res.stored_connections)) {
      connections = res.stored_connections;
    } else if (res?.currentSession?.connections && Array.isArray(res.currentSession.connections)) {
      connections = res.currentSession.connections;
    } else if (res?.acquisition_session?.connections && Array.isArray(res.acquisition_session.connections)) {
      connections = res.acquisition_session.connections;
    }
  }

  return connections || [];
}

async function hydrateActiveGraphPreview() {
  const connections = await getActiveConnections();
  if (connections && connections.length > 0) {
    latestData = { connections: connections, first_degree_count: connections.length };
    renderExtractionPreview(latestData);
  }
}

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      if (changes.currentSession || changes.acquisition_session || changes.warmgraph_active_graph) {
        fetchAcquisitionStatus().then((res) => {
          if (res && res.status) {
            updateAcquisitionDashboard(res.status);
          }
        });
        hydrateActiveGraphPreview();
      }
      // Update identity banner immediately when content.js writes warmgraph_owner
      if (changes.warmgraph_owner) {
        const owner = changes.warmgraph_owner.newValue;
        if (owner && owner.ownerId) {
          renderIdentityReady(owner.ownerId, owner.profileUrl);
        }
      }
    }
  });
}

function startStatusPolling() {
  stopStatusPolling();
  statusPollInterval = setInterval(async () => {
    try {
      const res = await fetchAcquisitionStatus();
      if (res && res.status) {
        updateAcquisitionDashboard(res.status);
      }
    } catch (e) {
      // Ignore polling errors while tab/popup changes
    }
  }, 400);
}

function stopStatusPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}

// Initial status load & auto-poll
(async () => {
  try {
    const res = await fetchAcquisitionStatus();
    if (res && res.status) {
      updateAcquisitionDashboard(res.status);
    }
  } catch (e) {
    // Ignore initial error
  }
  hydrateActiveGraphPreview();
  startStatusPolling();
})();


/* =========================================================
   EXTRACT LINKEDIN DATA
========================================================= */

const extractBtn = document.getElementById("extract");
if (extractBtn) {
  extractBtn.addEventListener(
    "click",
    async () => {

      try {

        const [tab] =
          await chrome.tabs.query({
            active: true,
            currentWindow: true
          });


        if (!tab || !tab.id) {

          output.textContent =
            "No active tab found.";

          return;

        }


        if (
          !tab.url ||
          (
            !tab.url.includes("linkedin.com") &&
            !tab.url.startsWith(
              "http://127.0.0.1:5500"
            )
          )
        ) {

          output.textContent =
            "Please open a LinkedIn page first.";

          return;

        }


        output.textContent =
          "Reading visible LinkedIn DOM...";


        chrome.tabs.sendMessage(
          tab.id,
          {
            action:
              "extractLinkedIn"
          },
          (response) => {

            if (
              chrome.runtime.lastError
            ) {

              output.textContent =
                "Could not read LinkedIn page.\n\n" +
                chrome.runtime.lastError.message;

              return;

            }


            if (!response) {

              output.textContent =
                "No response received from LinkedIn page.";

              return;

            }


            if (!response.success) {

              output.textContent =
                "Extraction failed.\n\n" +
                response.error;

              return;

            }


            latestData =
              response;


            renderExtractionPreview(
              response
            );

          }
        );


      } catch (error) {

        output.textContent =
          "Unexpected error.\n\n" +
          error.message;

      }

    }
  );
}


/* =========================================================
   BACKEND HELPERS
========================================================= */

/**
 * Get the canonical owner ID for all backend requests.
 * Loads strictly from warmgraph_owner.ownerId (or legacy ownerId key if non-UUID).
 * Never derives from selected target, current profile page, or session.
 */
async function getOwnerForBackend() {
  const { warmgraph_owner, ownerId } = await new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["warmgraph_owner", "ownerId"], (res) => resolve(res || {}));
    } else {
      resolve({});
    }
  });

  const canonicalId = warmgraph_owner?.ownerId || (ownerId && !ownerId.startsWith("warmgraph_") ? ownerId : null);

  if (!canonicalId) {
    throw new Error(
      "Owner identity not detected yet. Please open your LinkedIn profile page once to let WarmGraph identify you."
    );
  }

  return canonicalId;
}


async function backendRequest(
  path,
  options = {}
) {

  const response =
    await fetch(
      `${BACKEND_BASE_URL}${path}`,
      options
    );


  const result =
    await response.json();


  if (!response.ok) {

    throw new Error(
      result.detail ||
      "Backend request failed."
    );

  }


  return result;

}


/* =========================================================
   REFRESH DATA
========================================================= */

document
  .getElementById("refresh")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();

        const result =
          await backendRequest(
            "/refresh",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  owner_id:
                    ownerId,

                  force:
                    false
                })
            }
          );

        // Reload persisted backend graph into warmgraph_active_graph
        try {
          const network = await backendRequest(`/network/${encodeURIComponent(ownerId)}`);
          if (network && Array.isArray(network.connections)) {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({
                warmgraph_active_graph: {
                  owner_id: ownerId,
                  connections: network.connections,
                  totalConnections: network.connections.length,
                  lastRefreshedAt: new Date().toISOString()
                }
              });
            }
          }
        } catch (_) {}

        output.innerHTML = `

          <div class="status-box">

            <strong>
              Refresh job queued
            </strong>

            <br><br>

            Job:
            ${escapeHtml(
              result.job_id
            )}

          </div>

        `;

      } catch (error) {

        output.textContent =
          `Refresh failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   TARGET SEARCH
========================================================= */

document
  .getElementById("searchTarget")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const companyInput =
          document.getElementById(
            "company"
          );

        const dealSideInput =
          document.getElementById(
            "dealSide"
          );

        const targetRoleInput =
          document.getElementById(
            "targetRole"
          );


        const company =
          companyInput
            ? companyInput.value.trim()
            : "";


        const dealSide =
          dealSideInput
            ? dealSideInput.value
            : "sell_side";


        const targetRole =
          targetRoleInput
            ? targetRoleInput.value.trim()
            : "";


        /* -----------------------------------------
           VALIDATE COMPANY
        ----------------------------------------- */

        if (!company) {
          if (targetSearchResultsEl) {
            targetSearchResultsEl.innerHTML = `
              <div class="status-box">
                <strong>Enter a target company</strong>
                <br><br>
                Example: Company B
              </div>
            `;
          }
          if (companyInput) {
            companyInput.focus();
          }
          return;
        }

        const requestBody = {
          owner_id: ownerId,
          company: company,
          deal_side: dealSide,
          target_role: targetRole
        };

        if (targetSearchResultsEl) {
          targetSearchResultsEl.innerHTML = `
            <div class="status-box">
              Searching for target person...
              <br><br>
              Company: ${escapeHtml(company)}
              <br>
              Role: ${escapeHtml(targetRole || "Any role")}
            </div>
          `;
        }

        const result = await handleTargetSearch(company, targetRole, dealSide, ownerId);
        targetSearchState = result;
        renderTargetSearch(targetSearchState);

      } catch (error) {
        if (targetSearchResultsEl) {
          targetSearchResultsEl.innerHTML = `
            <div class="status-box">
              <strong>Target search failed</strong>
              <br><br>
              ${escapeHtml(error.message)}
            </div>
          `;
        }
      }
    }
  );

function searchLocalConnections(connections, company, targetRole) {
  const companyQuery = (company || "").trim().toLowerCase();
  const roleQuery = (targetRole || "").trim().toLowerCase();

  const candidates = (connections || []).filter(c => {
    const searchable = [
      c.name,
      c.headline,
      c.occupation,
      c.company,
      c.profile_url
    ].filter(Boolean).join(" ").toLowerCase();

    const companyMatch = !companyQuery || searchable.includes(companyQuery);
    const roleMatch = !roleQuery || searchable.includes(roleQuery);

    return companyMatch && roleMatch;
  }).map(connection => ({
    name: connection.name || "Unknown",
    headline: connection.headline || connection.occupation || connection.title || "",
    profile_url: connection.profile_url || connection.url || connection.link || "",
    degree: connection.degree || "1st",
    confidence: connection.confidence !== undefined ? connection.confidence : 1.0,
    warmth: connection.warmth !== undefined ? connection.warmth : "High",
    matched_role: targetRole || "Connection",
    reason: `Matched from Active Graph (${connection.name || "Connection"})`
  }));

  return {
    company: company,
    deal_side: "sell_side",
    candidates: candidates
  };
}

async function handleTargetSearch(company, role, dealSide, ownerId) {
  // 1. Single Shared Source of Truth: getActiveConnections()
  const connections = await getActiveConnections();

  if (connections && connections.length > 0) {
    const localResult = searchLocalConnections(connections, company, role);
    if (localResult && localResult.candidates && localResult.candidates.length > 0) {
      return localResult;
    }
  }

  // 2. If local graph is missing, THEN call /target/search
  try {
    const result = await backendRequest("/target/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_id: ownerId,
        company: company,
        deal_side: dealSide,
        target_role: role
      })
    });
    return result;
  } catch (error) {
    return {
      company: company,
      deal_side: dealSide,
      candidates: [],
      error: error.message
    };
  }
}

async function searchLocalActiveGraph(company, targetRole) {
  const connections = await getActiveConnections();
  return searchLocalConnections(connections, company, targetRole);
}


/* =========================================================
   TARGET SEARCH RESULT
========================================================= */

function renderTargetSearch(result) {
  let candidates = [];

  if (Array.isArray(result.candidates)) {
    candidates = result.candidates;
  } else if (Array.isArray(result.results)) {
    candidates = result.results;
  } else if (Array.isArray(result.matches)) {
    candidates = result.matches;
  } else if (result.name || result.person_name || result.profile_url) {
    candidates = [result];
  }

  const container = targetSearchResultsEl || document.getElementById("targetSearchResults") || output;

  if (candidates.length === 0) {
    container.innerHTML = `
      <div class="status-box empty">
        <strong>No target person found</strong>
        <br><br>
        Company: ${escapeHtml(result.company || "Unknown")}
        <br>
        Deal side: ${escapeHtml(result.deal_side || "Unknown")}
        ${result.message ? `<br><br>${escapeHtml(result.message)}` : ""}
      </div>
    `;
    return;
  }

  let html = `
    <div class="section-title">
      Target Search Results (${candidates.length})
    </div>
  `;

  candidates.forEach((person) => {
    const name = person.name || person.person_name || "Unknown person";
    const headline = person.headline || person.title || person.matched_role || null;
    const targetUrl = person.profile_url || person.person_id || person.id || "";

    html += `
      <div class="record">
        <div class="record-header">
          <div class="avatar-circle">${escapeHtml(getInitials(name))}</div>
          <div>
            <div class="record-name">${escapeHtml(name)}</div>
            ${headline ? `<div class="record-headline">${escapeHtml(headline)}</div>` : ""}
          </div>
        </div>

        <div class="record-meta">
          ${person.degree ? `<span class="badge">${escapeHtml(person.degree)}</span>` : ""}
          ${person.matched_role ? `<span class="badge">Role match</span>` : ""}
          ${person.confidence !== undefined ? `<span class="badge badge-success">Confidence: ${escapeHtml(person.confidence)}</span>` : ""}
          ${person.warmth !== undefined ? `<span class="badge badge-success">Warmth: ${escapeHtml(person.warmth)}</span>` : ""}
        </div>

        ${person.reason ? `<div class="mutual"><strong>Why matched:</strong> ${escapeHtml(person.reason)}</div>` : ""}
        ${person.path_count !== undefined ? `<div class="mutual"><strong>Paths found:</strong> ${escapeHtml(person.path_count)}</div>` : ""}

        ${targetUrl ? `
          <div style="margin-top:10px; display:flex; gap:8px;">
            <button type="button" class="use-as-target-btn secondary-action-btn" data-url="${escapeHtml(targetUrl)}" data-name="${escapeHtml(name)}" data-role="${escapeHtml(headline || '')}" style="flex:1; min-height:36px; padding:0 10px; font-size:11px;">
              Use as Target
            </button>
            <button type="button" class="find-candidate-path-btn primary-action-btn" data-url="${escapeHtml(targetUrl)}" data-name="${escapeHtml(name)}" data-role="${escapeHtml(headline || '')}" style="flex:1; min-height:36px; padding:0 10px; font-size:11px;">
              Find Warm Path
            </button>
          </div>
          <a class="record-link" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(targetUrl)}</a>
        ` : ""}
      </div>
    `;
  });

  container.innerHTML = html;

  const selectTarget = (url, name, role) => {
    let targetId = url;
    if (url.includes("/in/")) {
      const match = url.match(/\/in\/([^/?#]+)/);
      if (match && match[1]) targetId = match[1];
    }

    selectedTargetState = { url, name, role, targetId };

    // Write canonical selected_target — NEVER touches warmgraph_owner
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        selected_target: {
          targetId: targetId,
          name: name || "",
          profileUrl: url,
          role: role || "",
          selectedAt: new Date().toISOString()
        }
      });
    }

    const targetInput = document.getElementById("pathTarget");
    if (targetInput) {
      targetInput.value = url;
      targetInput.focus();
      targetInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (selectedTargetBadgeEl) {
      selectedTargetBadgeEl.style.display = "block";
      selectedTargetBadgeEl.innerHTML = `<strong>Selected Target:</strong> ${escapeHtml(name)}${role ? ` (${escapeHtml(role)})` : ''}`;
    }
  };

  container.querySelectorAll(".use-as-target-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectTarget(
        btn.getAttribute("data-url") || "",
        btn.getAttribute("data-name") || "",
        btn.getAttribute("data-role") || ""
      );
    });
  });

  container.querySelectorAll(".find-candidate-path-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectTarget(
        btn.getAttribute("data-url") || "",
        btn.getAttribute("data-name") || "",
        btn.getAttribute("data-role") || ""
      );
      const findPathBtn = document.getElementById("findPath");
      if (findPathBtn) {
        findPathBtn.click();
      }
    });
  });
}


/* =========================================================
   FIND WARM PATH
========================================================= */

document
  .getElementById("findPath")
  .addEventListener(
    "click",
    async () => {

      try {

        const { warmgraph_owner, ownerId: legacyOwnerId, selected_target } =
          await new Promise(r => {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get(["warmgraph_owner", "ownerId", "selected_target"], r);
            } else {
              r({});
            }
          });

        const ownerId = warmgraph_owner?.ownerId || (legacyOwnerId && !legacyOwnerId.startsWith("warmgraph_") ? legacyOwnerId : null);

        if (!ownerId) {
          throw new Error(
            "Owner identity not detected yet. Please open your LinkedIn profile page once to let WarmGraph identify you."
          );
        }

        const inputTargetUrl =
          document
            .getElementById(
              "pathTarget"
            )
            .value
            .trim();

        if (!inputTargetUrl) {
          if (pathResultsEl) {
            pathResultsEl.innerHTML = `
              <div class="status-box">
                <strong>Enter a target profile URL</strong>
                <br><br>
                Example: https://www.linkedin.com/in/target-person
              </div>
            `;
          }
          return;
        }

        if (pathResultsEl) {
          pathResultsEl.innerHTML = `
            <div class="status-box">Calculating warm path...</div>
          `;
        }

        const st = selected_target;
        const targetUrl = (inputTargetUrl && st?.profileUrl && (st.profileUrl === inputTargetUrl || inputTargetUrl.includes(st.targetId))) ? st.profileUrl : inputTargetUrl;
        const targetId = st?.targetId || (inputTargetUrl.match(/\/in\/([^/?#]+)/)?.[1] || inputTargetUrl);
        const targetName = st?.name || "";

        // Store into selected_target — NEVER touch warmgraph_owner
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            selected_target: {
              targetId: targetId,
              name: targetName || targetId,
              profileUrl: targetUrl
            }
          });
        }

        const result = await backendRequest("/graph/path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner_id: ownerId,
            source_id: ownerId,
            target_url: targetUrl,
            target_id: targetId,
            target_name: targetName,
            cutoff: 4
          })
        });

        warmPathState = result;
        renderPathResult(warmPathState);

      } catch (error) {
        if (pathResultsEl) {
          pathResultsEl.innerHTML = `
            <div class="status-box">
              <strong>Path search failed</strong>
              <br><br>
              ${escapeHtml(error.message)}
            </div>
          `;
        }
      }
    }
  );


/* =========================================================
   EXPLAIN WARM PATH
========================================================= */

document
  .getElementById("explainPath")
  .addEventListener(
    "click",
    async () => {
      try {
        const { warmgraph_owner, ownerId: legacyOwnerId, selected_target } =
          await new Promise(r => {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get(["warmgraph_owner", "ownerId", "selected_target"], r);
            } else {
              r({});
            }
          });

        const ownerId = warmgraph_owner?.ownerId || (legacyOwnerId && !legacyOwnerId.startsWith("warmgraph_") ? legacyOwnerId : null);

        if (!ownerId) {
          throw new Error(
            "Owner identity not detected yet. Please open your LinkedIn profile page once to let WarmGraph identify you."
          );
        }

        const inputTargetUrl = document.getElementById("pathTarget").value.trim();

        if (!inputTargetUrl) {
          if (pathResultsEl) {
            pathResultsEl.innerHTML = `
              <div class="status-box">
                <strong>Enter a target profile URL</strong>
                <br><br>
                Example: https://www.linkedin.com/in/target-person
              </div>
            `;
          }
          return;
        }

        if (pathResultsEl) {
          pathResultsEl.innerHTML = `
            <div class="status-box">Generating warm-path explanation...</div>
          `;
        }

        const st = selected_target;
        const targetUrl = (inputTargetUrl && st?.profileUrl && (st.profileUrl === inputTargetUrl || inputTargetUrl.includes(st.targetId))) ? st.profileUrl : inputTargetUrl;
        const targetId = st?.targetId || (inputTargetUrl.match(/\/in\/([^/?#]+)/)?.[1] || inputTargetUrl);
        const targetName = st?.name || "";

        const result = await backendRequest("/graph/explain-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner_id: ownerId,
            source_id: ownerId,
            target_url: targetUrl,
            target_id: targetId,
            target_name: targetName,
            cutoff: 4
          })
        });

        explainPathState = result;
        renderPathExplanation(explainPathState);

      } catch (error) {
        if (pathResultsEl) {
          pathResultsEl.innerHTML = `
            <div class="status-box">
              <strong>Path explanation failed</strong>
              <br><br>
              ${escapeHtml(error.message)}
            </div>
          `;
        }
      }
    }
  );


/* =========================================================
   PATH EXPLANATION RESULT
========================================================= */

function renderEvidenceBadges(evidenceList) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return "";

  const iconMap = {
    same_college: "🎓",
    student_faculty: "👨‍🏫",
    same_dept: "🏛️",
    same_company: "💼",
    same_city: "📍",
    linkedin_1st_degree: "⚡"
  };

  const badgesHtml = evidenceList.map(ev => {
    const icon = iconMap[ev.type] || "🔗";
    const confPercent = Math.round((ev.confidence || 0.7) * 100);
    return `<span class="badge" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8; font-size: 11px; padding: 4px 8px; margin-right: 4px; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;">
      ${icon} ${escapeHtml(ev.label)} (${confPercent}%)
    </span>`;
  }).join("");

  return `<div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">${badgesHtml}</div>`;
}

function renderPathExplanation(result) {
  const explanation = result.explanation || result.message || result.detail || "";
  const paths = Array.isArray(result.paths) ? result.paths : [];
  const topEvidence = Array.isArray(result.evidence) ? result.evidence : [];
  const container = pathResultsEl || document.getElementById("pathResults") || output;

  let html = `
    <div class="section-title">Warm Path Explanation</div>
  `;

  if (paths.length > 0) {
    paths.forEach((path, index) => {
      const pathEv = Array.isArray(path.evidence) ? path.evidence : [];
      html += `
        <div class="record">
          <div class="record-name">Path ${index + 1}</div>
          ${path.warmth !== undefined ? `
            <div class="record-meta">
              <span class="badge">Warmth: ${escapeHtml(path.warmth)}</span>
              ${path.hops !== undefined ? `<span class="badge">${escapeHtml(path.hops)} hops</span>` : ""}
            </div>
          ` : ""}
          ${Array.isArray(path.path) ? `
            <div class="mutual"><strong>Path:</strong> ${escapeHtml(path.path.join(" → "))}</div>
          ` : ""}
          ${path.explanation ? `
            <div class="mutual"><strong>Explanation:</strong> ${escapeHtml(path.explanation)}</div>
          ` : ""}
          ${pathEv.length > 0 ? renderEvidenceBadges(pathEv) : ""}
        </div>
      `;
    });
  }

  if (explanation) {
    html += `
      <div class="record">
        <div class="record-name">Explanation</div>
        <div class="record-headline">${escapeHtml(explanation)}</div>
        ${topEvidence.length > 0 ? renderEvidenceBadges(topEvidence) : ""}
      </div>
    `;
  }

  if (!explanation && paths.length === 0) {
    html += `
      <div class="status-box empty">No explanation returned.</div>
    `;
  }

  container.innerHTML = html;
}


/* =========================================================
   PATH RESULT
========================================================= */

function renderPathResult(result) {
  const paths = result.paths || [];
  const container = pathResultsEl || document.getElementById("pathResults") || output;

  if (!Array.isArray(paths) || paths.length === 0) {
    container.innerHTML = `
      <div class="status-box empty">
        <strong>No warm path found</strong>
        <br><br>
        Target: ${escapeHtml(result.target_id || "Unknown")}
      </div>
    `;
    return;
  }

  let html = `
    <div class="summary">
      <div class="summary-card">
        <span class="summary-number">${paths.length}</span>
        <span class="summary-label">Path${paths.length === 1 ? "" : "s"}</span>
      </div>
    </div>
    <div class="section-title">Warm Paths</div>
  `;

  paths.forEach((path, index) => {
    const nodeArray = Array.isArray(path.path) ? path.path : [];
    html += `
      <div class="record">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div class="record-name">Warm Path ${index + 1}</div>
          <div>
            ${path.hops !== undefined ? `<span class="badge">${escapeHtml(path.hops)} hops</span>` : ""}
            ${path.warmth !== undefined ? `<span class="badge badge-success">Warmth: ${escapeHtml(path.warmth)}</span>` : ""}
          </div>
        </div>

        ${nodeArray.length > 0 ? `
          <div class="timeline-wrapper">
            ${nodeArray.map((node, i) => `
              ${i > 0 ? `<div class="timeline-connector">↓</div>` : ""}
              <div class="timeline-node">
                <div class="avatar-circle">${escapeHtml(getInitials(node))}</div>
                <div>
                  <div class="record-name">${escapeHtml(node)}</div>
                  <div class="record-headline">${i === 0 ? "You (Graph Owner)" : (i === nodeArray.length - 1 ? "Target Profile" : "Intermediate Warm Connection")}</div>
                </div>
              </div>
            `).join("")}
          </div>
        ` : ""}

        ${path.explanation ? `<div class="mutual" style="margin-top:10px;"><strong>Explanation:</strong> ${escapeHtml(path.explanation)}</div>` : ""}

        ${Array.isArray(path.evidence) && path.evidence.length > 0 ? renderEvidenceBadges(path.evidence) : ""}

        <div style="margin-top:12px;">
          <button type="button" class="explain-single-path-btn secondary-action-btn" data-path="${escapeHtml(JSON.stringify(nodeArray))}" style="width:100%; min-height:36px; font-size:11px;">
            Explain This Path
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll(".explain-single-path-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const ownerId = await getOwnerForBackend();
        const rawPath = JSON.parse(btn.getAttribute("data-path") || "[]");
        container.innerHTML = `<div class="status-box">Generating path explanation...</div>`;
        const res = await backendRequest("/graph/explain-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner_id: ownerId, path: rawPath })
        });
        explainPathState = res;
        renderPathExplanation(explainPathState);
      } catch (e) {
        container.innerHTML = `<div class="status-box empty">Explanation failed: ${escapeHtml(e.message)}</div>`;
      }
    });
  });
}


/* =========================================================
   SEARCH NETWORK
========================================================= */

document
  .getElementById("searchNetwork")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        const query =
          encodeURIComponent(
            document
              .getElementById(
                "company"
              )
              .value
              .trim()
          );


        if (!query) {

          output.innerHTML = `

            <div class="status-box">

              Enter a company to search
              your network.

            </div>

          `;

          return;

        }


        const result =
          await backendRequest(
            `/graph/${encodeURIComponent(
              ownerId
            )}/search?q=${query}`
          );


        const matches = result.results || [];
        if (matches.length === 0) {
          output.innerHTML = `
            <div class="status-box empty">
              No connections found matching search query.
            </div>
          `;
          return;
        }

        let html = `
          <div class="section-title">
            Network Search Results (${matches.length})
          </div>
        `;

        matches.forEach((person) => {
          const name = person.name || "Unknown person";
          const headline = person.title || person.headline || person.company || "No details";
          const profileUrl = person.profile_url || person.id || "";

          html += `
            <div class="record">
              <div class="record-name">${escapeHtml(name)}</div>
              <div class="record-headline">${escapeHtml(headline)}</div>
              ${profileUrl ? `
                <div style="margin-top:6px;">
                  <button type="button" class="use-as-target-btn" data-url="${escapeHtml(profileUrl)}" style="width:auto; padding:5px 10px; font-size:11px; background:#eef4ff; color:#0A66C2; border:1px solid #b8c9e8; border-radius:4px; cursor:pointer; font-weight:600;">
                    Use as Path Target
                  </button>
                </div>
                <a class="record-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profileUrl)}</a>
              ` : ""}
            </div>
          `;
        });

        output.innerHTML = html;

        document.querySelectorAll(".use-as-target-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const targetInput = document.getElementById("pathTarget");
            if (targetInput) {
              targetInput.value = btn.getAttribute("data-url") || "";
              targetInput.focus();
              targetInput.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          });
        });


      } catch (error) {

        output.textContent =
          `Network search failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   VIEW GRAPH
========================================================= */

document
  .getElementById("viewGraph")
  .addEventListener(
    "click",
    async () => {

      try {

        const ownerId =
          await getOwnerForBackend();


        await chrome.tabs.create({

          url:
            `${BACKEND_BASE_URL}/graph/view?owner_id=` +
            `${encodeURIComponent(
              ownerId
            )}`

        });


      } catch (error) {

        output.textContent =
          `Graph view failed.\n\n` +
          error.message;

      }

    }
  );


/* =========================================================
   SEND TO BACKEND (User-initiated sharing with explicit confirmation)
========================================================= */

const sendBtn = document.getElementById("send");
if (sendBtn) {
  sendBtn.addEventListener(
    "click",
    async () => {

      if (!latestData) {

        output.textContent =
          "Extract LinkedIn data first.";

        return;

      }


      const identity =
        await getStoredOwnerId();


      if (!identity.ownerId) {

        output.textContent =
          "Couldn't detect your LinkedIn identity yet.\n\n" +
          "Visit any LinkedIn page with the extension active " +
          "and try again.";

        return;

      }

      const connectionCount = (latestData.connections || []).length;
      const evidenceCount = (latestData.relationship_evidence || []).length;

      // EXPLICIT CONFIRMATION STEP
      output.innerHTML = `

        <div class="status-box" style="border: 2px solid #2457a6; background: #f0f4fc;">

          <strong style="font-size: 14px; color: #11366b;">
            Confirm & Share Network Data
          </strong>

          <br><br>

          You are about to share the extracted network data with your Fenon tenant:

          <br><br>

          • <strong>${connectionCount}</strong> 1st-degree connections<br>
          • <strong>${evidenceCount}</strong> relationship evidence items

          <br><br>

          Owner ID: <code>${escapeHtml(identity.ownerId)}</code>

          <br><br>

          <button id="confirmShare" style="background: #2457a6; color: white; border-color: #1b4485; font-weight: 700; margin-bottom: 6px;">
            Confirm & Share Network Data
          </button>

          <button id="cancelShare" style="background: #ffffff; color: #444; border-color: #ccc;">
            Cancel
          </button>

        </div>

      `;

      document.getElementById("cancelShare").addEventListener("click", () => {
        renderExtractionPreview(latestData);
      });

      document.getElementById("confirmShare").addEventListener("click", async () => {
        try {

          const payload = {
            owner_id: identity.ownerId,
            source: "linkedin_dom",
            confirmed: true,
            connections: latestData.connections || [],
            relationship_evidence: latestData.relationship_evidence || [],
            page_type: latestData.page_type,
            page_url: latestData.page_url
          };

          output.innerHTML = `
            <div class="status-box">
              Sending confirmed network data to backend...
            </div>
          `;

          const response = await fetch(
            `${BACKEND_BASE_URL}/network/import`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            }
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(
              result.detail ||
              "Backend request failed."
            );
          }

          // Step 2: Ensure warmgraph_active_graph.owner_id matches canonical ownerId
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(["warmgraph_owner", "warmgraph_active_graph"], (stored) => {
              const canonicalOwnerId = stored.warmgraph_owner?.ownerId || identity.ownerId;
              const activeGraph = stored.warmgraph_active_graph || {};
              activeGraph.owner_id = canonicalOwnerId;
              activeGraph.connections = latestData.connections || activeGraph.connections || [];
              activeGraph.totalConnections = activeGraph.connections.length;

              chrome.storage.local.set({
                warmgraph_active_graph: activeGraph
              });
            });
          }

          output.innerHTML = `
            <div class="status-box">
              <strong style="color: #1e4620;">
                Backend import successful
              </strong>
              <br><br>
              1st-degree connections: ${escapeHtml(result.connection_count)}<br>
              Relationship evidence: ${escapeHtml(result.relationship_evidence_count)}<br>
              Graph nodes: ${escapeHtml(result.graph_nodes)}<br>
              Graph edges: ${escapeHtml(result.graph_edges)}
            </div>
          `;

        } catch (error) {
          output.innerHTML = `
            <div class="status-box">
              <strong style="color: #8b0000;">
                Backend error
              </strong>
              <br><br>
              ${escapeHtml(error.message)}
            </div>
          `;
        }
      });

    }
  );
}