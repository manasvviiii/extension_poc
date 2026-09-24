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

function getStoredOwnerId() {
  return new Promise((resolve) => {

    chrome.storage.local.get(
      ["ownerId", "externalProfileUrl"],
      (result) => {

        resolve({
          ownerId:
            result.ownerId || null,

          externalProfileUrl:
            result.externalProfileUrl || null
        });

      }
    );

  });
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



/* =========================================================
   SHOW DETECTED IDENTITY
========================================================= */

(async () => {

  const identityEl =
    document.getElementById("identity");

  const identity =
    await getStoredOwnerId();


  if (identity.ownerId) {

    identityEl.className =
      "detected";

    identityEl.textContent =
      `Identity Ready ✓ ${identity.externalProfileUrl ? "(" + identity.externalProfileUrl + ")" : ""}`;

  } else {

    identityEl.className =
      "pending";

    identityEl.textContent =
      "Identity Pending — Open any LinkedIn page to connect owner ID.";

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
      html += `
        <div class="record">
          <div class="record-name">
            ${escapeHtml(person.name || "Unknown person")}
          </div>

          <div class="record-headline">
            ${escapeHtml(person.headline || person.occupation || "No headline available")}
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
      title: "Network Ready",
      badgeText: "● Ready",
      subtext: "Open your LinkedIn Connections page to build your network map.",
      isComplete: false,
      isSyncing: false,
      isSyncFailed: false
    };
  }

  const state = status.state || "idle";
  const collected = status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0);
  const expected = status.expected_total || status.reliable_dom_total || 0;
  const syncStatus = status.sync_status || "idle";
  const isError = state === "failed" || state === "error" || (status.error && status.error.length > 0);

  if (isError) {
    return {
      title: "Something went wrong",
      badgeText: "⚠️ Attention Required",
      subtext: status.error || status.status_message || "An unexpected issue occurred. Try reopening your LinkedIn Connections page.",
      isComplete: false,
      isSyncing: false,
      isSyncFailed: false
    };
  }

  switch (state) {
    case "preparing":
      return {
        title: "Preparing your network",
        badgeText: "● Preparing",
        subtext: "WarmGraph is getting things ready.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "acquiring":
    case "collecting":
      return {
        title: "Building your network",
        badgeText: "● Building network",
        subtext: `${collected > 0 ? collected + " connections discovered." : "Discovering connections."}\n\nYou can keep browsing — WarmGraph is working quietly in the background.`,
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "waiting":
    case "waiting_for_content":
      return {
        title: "Loading more connections...",
        badgeText: "● Waiting for content",
        subtext: "WarmGraph is waiting for the page to finish loading.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "settling":
      return {
        title: "Checking your network...",
        badgeText: "● Verifying page",
        subtext: "Making sure there are no more connections to add.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "paused":
    case "interrupted":
      return {
        title: "We'll continue when you're back",
        badgeText: "⏸ Saved",
        subtext: "Your progress is saved. Return to your Connections page when you're ready.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "resumed":
      return {
        title: "Building your network",
        badgeText: "● Resuming",
        subtext: `Continuing from ${collected} connections. You can keep browsing freely.`,
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };

    case "completed":
      if (syncStatus === "syncing") {
        return {
          title: "Saving your network...",
          badgeText: "● Saving network",
          subtext: `${collected} connections collected. Saving your network to WarmGraph...`,
          isComplete: false,
          isSyncing: true,
          isSyncFailed: false
        };
      } else if (syncStatus === "synced") {
        return {
          title: "Your network is ready ✨",
          badgeText: "✓ Up to date",
          subtext: `${collected} connections are now available in WarmGraph. Ready to research people and companies.`,
          isComplete: true,
          isSyncing: false,
          isSyncFailed: false
        };
      } else if (syncStatus === "failed" || syncStatus === "sync_failed") {
        return {
          title: `${collected} connections collected`,
          badgeText: "⚠️ Sync pending",
          subtext: "We couldn't finish saving your network yet. We'll try again automatically.",
          isComplete: false,
          isSyncing: false,
          isSyncFailed: true
        };
      } else if (syncStatus === "blocked") {
        return {
          title: `${collected} connections collected`,
          badgeText: "⚠️ Sync pending",
          subtext: "Complete dataset required before saving network data.",
          isComplete: false,
          isSyncing: false,
          isSyncFailed: true
        };
      } else {
        return {
          title: "Saving your network...",
          badgeText: "● Saving network",
          subtext: `Preparing to save ${collected} connections to WarmGraph...`,
          isComplete: false,
          isSyncing: true,
          isSyncFailed: false
        };
      }

    case "idle":
    default:
      if (collected > 0) {
        if (syncStatus === "synced") {
          return {
            title: "Your network is ready ✨",
            badgeText: "✓ Network ready",
            subtext: `${collected} connections catalogued in WarmGraph.`,
            isComplete: true,
            isSyncing: false,
            isSyncFailed: false
          };
        } else if (syncStatus === "failed" || syncStatus === "sync_failed") {
          return {
            title: `${collected} connections collected`,
            badgeText: "⚠️ Sync pending",
            subtext: "Network collected locally. We'll try saving to WarmGraph automatically.",
            isComplete: false,
            isSyncing: false,
            isSyncFailed: true
          };
        } else {
          return {
            title: `${collected} connections collected`,
            badgeText: "● Network collected",
            subtext: `${collected} connections saved in local session.`,
            isComplete: false,
            isSyncing: false,
            isSyncFailed: false
          };
        }
      }
      return {
        title: "Network Ready",
        badgeText: "● Ready",
        subtext: "Open your LinkedIn Connections page to build your network map.",
        isComplete: false,
        isSyncing: false,
        isSyncFailed: false
      };
  }
}

function updateAcquisitionDashboard(status) {
  if (!status) return;

  const state = status.state;
  const collected = status.collected_count !== undefined ? status.collected_count : (status.connections ? status.connections.length : 0);
  const expected = status.expected_total || status.reliable_dom_total || 0;
  const missing = Math.max(0, expected - collected);

  const heroDisplayEl = document.getElementById("heroCountDisplay");
  const heroLabelEl = document.getElementById("heroCountLabel");
  const heroSecondaryEl = document.getElementById("heroSecondaryText");
  const statusBadgeEl = document.getElementById("acquisitionStatusBadge");

  const titleEl = document.getElementById("acquisitionStatusTitle");
  const countDisplayEl = document.getElementById("acquisitionCountDisplay");
  const instructionEl = document.getElementById("acquisitionInstruction");
  const syncBadgeEl = document.getElementById("syncStatusBadge");
  const progressBarEl = document.getElementById("acquisitionProgressBar");
  const remainingEl = document.getElementById("acquisitionRemainingText");
  const syncNetworkBtn = document.getElementById("syncNetworkBtn");
  const ctaSectionEl = document.getElementById("networkReadyCtaSection");
  const ctaBtnEl = document.getElementById("openWarmGraphWorkspaceBtn");

  const humanized = getHumanizedStateInfo(status);

  if (heroDisplayEl) {
    heroDisplayEl.textContent = collected;
  }

  if (heroLabelEl) {
    heroLabelEl.textContent = collected === 1 ? "connection" : "connections";
  }

  if (heroSecondaryEl) {
    if (expected > 0) {
      heroSecondaryEl.textContent = `${collected} of ${expected} connections`;
    } else {
      heroSecondaryEl.textContent = `${collected} connections discovered`;
    }
  }

  if (statusBadgeEl) {
    statusBadgeEl.textContent = humanized.badgeText;
  }

  if (titleEl) {
    titleEl.textContent = humanized.title;
  }

  if (countDisplayEl) {
    if (expected > 0) {
      countDisplayEl.textContent = `${collected} of ${expected} connections`;
    } else {
      countDisplayEl.textContent = `${collected} connections found`;
    }
  }

  if (instructionEl) {
    instructionEl.textContent = humanized.subtext;
  }

  const completionStatus = status.completion_status || (state === "completed" ? (collected >= expected ? "complete" : "complete_rendered_dataset") : "incomplete");
  const syncState = status.sync_status || "idle";

  const pct = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : (collected > 0 ? 100 : 0);

  if (progressBarEl) {
    progressBarEl.style.width = `${pct}%`;
  }

  if (remainingEl) {
    if (expected > 0) {
      remainingEl.textContent = missing > 0 ? `${missing} connection${missing > 1 ? 's' : ''} remaining (${pct}%)` : `All ${collected} connections catalogued (100%)`;
    } else {
      remainingEl.textContent = `${collected} connections catalogued`;
    }
  }

  if (ctaSectionEl) {
    if (humanized.isComplete) {
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

  // Sync Network Button logic
  const isReadyToSync = (completionStatus === "complete" || completionStatus === "complete_rendered_dataset" || (state === "completed" && collected >= expected - 1));

  if (syncNetworkBtn) {
    if (isReadyToSync && syncState !== "synced") {
      syncNetworkBtn.style.display = "inline-block";
      if (syncState === "syncing") {
        syncNetworkBtn.disabled = true;
        syncNetworkBtn.textContent = "Syncing...";
      } else {
        syncNetworkBtn.disabled = false;
        syncNetworkBtn.textContent = "Sync Network";
      }
    } else {
      syncNetworkBtn.style.display = "none";
    }

    if (!syncNetworkBtn._hasInitListener) {
      syncNetworkBtn._hasInitListener = true;
      syncNetworkBtn.addEventListener("click", async () => {
        try {
          syncNetworkBtn.disabled = true;
          syncNetworkBtn.textContent = "Syncing...";
          const res = await sendTabMessage("syncToBackend");
          if (res && res.success) {
            syncNetworkBtn.textContent = "Synced ✓";
            syncNetworkBtn.disabled = true;
            if (latestData) {
              latestData.sync_status = "synced";
              latestData.syncStatus = "synced";
            }
            chrome.storage.local.get(["acquisition_session"], (localRes) => {
              if (localRes && localRes.acquisition_session) {
                const sess = localRes.acquisition_session;
                sess.syncStatus = "synced";
                sess.sync_status = "synced";
                sess.syncMessage = "Backend sync completed successfully.";
                chrome.storage.local.set({ acquisition_session: sess });
              }
            });
            const updatedStatus = (res && res.status) ? { ...res.status, sync_status: "synced", syncStatus: "synced" } : {
              ...(latestData || {}),
              state: "completed",
              completion_status: "complete",
              sync_status: "synced",
              syncStatus: "synced"
            };
            updateAcquisitionDashboard(updatedStatus);
          } else {
            syncNetworkBtn.disabled = false;
            syncNetworkBtn.textContent = "Retry Sync";
            alert("Sync failed: " + ((res && (res.sync_message || res.error)) || "Unknown error"));
          }
        } catch (err) {
          syncNetworkBtn.disabled = false;
          syncNetworkBtn.textContent = "Retry Sync";
          alert("Sync error: " + err.message);
        }
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

  // Developer Extraction Dashboard button listener initialization
  const devDashBtn = document.getElementById("openDevDashboardBtn");
  if (devDashBtn && !devDashBtn._hasInitListener) {
    devDashBtn._hasInitListener = true;
    devDashBtn.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL("developer_dashboard.html") });
      } else if (typeof window !== "undefined") {
        window.open("developer_dashboard.html", "_blank");
      }
    });
  }

  // Developer Diagnostics drawer toggle listener initialization
  const toggleBtn = document.getElementById("toggleDebugTelemetryBtn");
  const diagEl = document.getElementById("telemetryDiagnostics");
  if (toggleBtn && !toggleBtn._hasInitListener) {
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
    chrome.storage.local.get(["acquisition_session"], (localRes) => {
      const localSession = localRes ? localRes.acquisition_session : null;

      const finishWithStatus = (res) => {
        if (res && res.status && localSession) {
          if (localSession.syncStatus === "synced" || localSession.sync_status === "synced") {
            res.status.syncStatus = "synced";
            res.status.sync_status = "synced";
          }
        }
        resolve(res);
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

async function getOwnerForBackend() {

  const identity =
    await getStoredOwnerId();


  if (!identity.ownerId) {

    throw new Error(
      "Owner identity is not ready yet."
    );

  }


  return identity.ownerId;

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

        const result = await backendRequest("/target/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        targetSearchState = result;
        console.log("[TARGET SEARCH]", {
          query: requestBody,
          responseCandidates: result.candidates ? result.candidates.length : 0,
          targetResultsRendered: (result.candidates || result.results || []).length
        });

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
        <div class="record-name">${escapeHtml(name)}</div>
        ${headline ? `<div class="record-headline">${escapeHtml(headline)}</div>` : ""}

        <div class="record-meta">
          ${person.degree ? `<span class="badge">${escapeHtml(person.degree)}</span>` : ""}
          ${person.matched_role ? `<span class="badge">Role match</span>` : ""}
          ${person.confidence !== undefined ? `<span class="badge">Confidence: ${escapeHtml(person.confidence)}</span>` : ""}
          ${person.warmth !== undefined ? `<span class="badge">Warmth: ${escapeHtml(person.warmth)}</span>` : ""}
        </div>

        ${person.reason ? `<div class="mutual"><strong>Why matched:</strong> ${escapeHtml(person.reason)}</div>` : ""}
        ${person.path_count !== undefined ? `<div class="mutual"><strong>Paths found:</strong> ${escapeHtml(person.path_count)}</div>` : ""}

        ${targetUrl ? `
          <div style="margin-top:8px; display:flex; gap:6px;">
            <button type="button" class="use-as-target-btn" data-url="${escapeHtml(targetUrl)}" data-name="${escapeHtml(name)}" data-role="${escapeHtml(headline || '')}" style="flex:1; padding:6px 10px; font-size:11px; background:#eef4ff; color:#0A66C2; border:1px solid #b8c9e8; border-radius:4px; cursor:pointer; font-weight:600;">
              Use as Path Target
            </button>
            <button type="button" class="find-candidate-path-btn" data-url="${escapeHtml(targetUrl)}" data-name="${escapeHtml(name)}" data-role="${escapeHtml(headline || '')}" style="flex:1; padding:6px 10px; font-size:11px; background:#0A66C2; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600;">
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
    selectedTargetState = { url, name, role };
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

        const ownerId =
          await getOwnerForBackend();


        const targetId =
          document
            .getElementById(
              "pathTarget"
            )
            .value
            .trim();


        if (!targetId) {
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

        const result = await backendRequest("/graph/path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner_id: ownerId,
            source_id: ownerId,
            target_id: targetId,
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
        const ownerId = await getOwnerForBackend();
        const targetId = document.getElementById("pathTarget").value.trim();

        if (!targetId) {
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

        const result = await backendRequest("/graph/explain-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner_id: ownerId,
            source_id: ownerId,
            target_id: targetId,
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

function renderPathExplanation(result) {
  const explanation = result.explanation || result.message || result.detail || "";
  const paths = Array.isArray(result.paths) ? result.paths : [];
  const container = pathResultsEl || document.getElementById("pathResults") || output;

  let html = `
    <div class="section-title">Warm Path Explanation</div>
  `;

  if (paths.length > 0) {
    paths.forEach((path, index) => {
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
        </div>
      `;
    });
  }

  if (explanation) {
    html += `
      <div class="record">
        <div class="record-name">Explanation</div>
        <div class="record-headline">${escapeHtml(explanation)}</div>
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
    html += `
      <div class="record">
        <div class="record-name">Path ${index + 1}</div>
        ${path.hops !== undefined ? `<div class="record-meta"><span class="badge">${escapeHtml(path.hops)} hops</span></div>` : ""}
        ${path.warmth !== undefined ? `<div class="mutual"><strong>Warmth:</strong> ${escapeHtml(path.warmth)}</div>` : ""}
        ${path.explanation ? `<div class="mutual"><strong>Explanation:</strong> ${escapeHtml(path.explanation)}</div>` : ""}
        ${Array.isArray(path.path) ? `<div class="mutual"><strong>Path:</strong> ${escapeHtml(path.path.join(" → "))}</div>` : ""}
        <div style="margin-top:8px;">
          <button type="button" class="explain-single-path-btn" data-path="${escapeHtml(JSON.stringify(path.path || []))}" style="width:auto; padding:5px 10px; font-size:11px; background:#f0f4f9; color:#1a73e8; border:1px solid #dadce0; border-radius:4px; cursor:pointer; font-weight:600;">
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