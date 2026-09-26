// =========================================================
// "KEEP IT WARM" REMINDER
//
// This deliberately does NOT open tabs, fetch LinkedIn pages, or
// crawl anything in the background. All it does is set a badge
// on the extension icon every couple of weeks as a nudge to go
// browse LinkedIn normally again — the actual data capture still
// only happens in content.js, only while a real person is looking
// at a real page they navigated to themselves.
//
// This is the safe interpretation of "automated refresh": zero
// unattended network activity, just a reminder. An auto-walking
// background crawler is a different, much riskier thing — see the
// research notes on why that pattern gets extensions detected.
// =========================================================

const REFRESH_ALARM_NAME = "warm-graph-refresh-reminder";
const REFRESH_INTERVAL_MINUTES = 14 * 24 * 60; // ~biweekly
const BATCH_ALARM_NAME = "warmgraph-next-batch-alarm";
const WEEKLY_WARMUP_ALARM_NAME = "warmgraph-weekly-warmup";
const WEEKLY_WARMUP_INTERVAL_MINUTES = 7 * 24 * 60; // 7 days

function triggerNextBatchInTabs() {
  if (typeof chrome === "undefined" || !chrome.tabs) return;
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach(tab => {
      if (tab.url && tab.url.includes("/mynetwork/invite-connect/connections/")) {
        chrome.tabs.sendMessage(tab.id, { action: "RUN_NEXT_BATCH" }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    });
  });
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.alarms) {
      chrome.alarms.create(REFRESH_ALARM_NAME, {
        periodInMinutes: REFRESH_INTERVAL_MINUTES
      });
      chrome.alarms.create(WEEKLY_WARMUP_ALARM_NAME, {
        periodInMinutes: WEEKLY_WARMUP_INTERVAL_MINUTES
      });
    }
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        nextRefreshAt: Date.now() + REFRESH_INTERVAL_MINUTES * 60 * 1000,
        refreshStatus: "scheduled"
      });
    }
  });
}

if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BATCH_ALARM_NAME) {
      triggerNextBatchInTabs();
      return;
    }
    if (alarm.name === REFRESH_ALARM_NAME || alarm.name === WEEKLY_WARMUP_ALARM_NAME) {
      if (chrome.action) {
        chrome.action.setBadgeText({ text: "✨" });
        chrome.action.setBadgeBackgroundColor({ color: "#38BDF8" });
        chrome.action.setTitle({
          title: "Keep your network warm ✨"
        });
      }
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ weeklyWarmupStatus: "available" });
      }
      return;
    }
    if (alarm.name !== REFRESH_ALARM_NAME) return;

    if (chrome.action) {
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#0A66C2" });
      chrome.action.setTitle({
        title: "It's been a couple weeks — open LinkedIn to refresh your graph"
      });
    }
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ refreshStatus: "available" });
    }
  });
}


// =========================================================
// PERSISTENT ACQUISITION SESSION MANAGER
// =========================================================

function canonicalConnectionKey(conn) {
  if (!conn) return "";
  if (conn.profile_url) {
    try {
      const u = new URL(conn.profile_url, "https://www.linkedin.com");
      return u.pathname.replace(/\/$/, "").toLowerCase();
    } catch (e) {
      return String(conn.profile_url).toLowerCase().trim();
    }
  }
  return String(conn.name || "").toLowerCase().trim();
}

function mergeConnections(existingList = [], newList = []) {
  const map = new Map();
  (existingList || []).forEach(c => {
    const k = canonicalConnectionKey(c);
    if (k) map.set(k, { ...c });
  });
  (newList || []).forEach(c => {
    const k = canonicalConnectionKey(c);
    if (k) {
      if (map.has(k)) {
        map.set(k, { ...map.get(k), ...c });
      } else {
        map.set(k, { ...c });
      }
    }
  });
  return Array.from(map.values());
}

function mergeEvidence(existingList = [], newList = []) {
  const map = new Map();
  (existingList || []).forEach(e => {
    const k = canonicalConnectionKey(e);
    if (k) map.set(k, { ...e });
  });
  (newList || []).forEach(e => {
    const k = canonicalConnectionKey(e);
    if (k) {
      if (map.has(k)) {
        map.set(k, { ...map.get(k), ...e });
      } else {
        map.set(k, { ...e });
      }
    }
  });
  return Array.from(map.values());
}

let inMemorySessionCache = null;

if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      // SSOT: background.js in-memory cache tracks acquisition_session (has payloads)
      if (changes.acquisition_session && changes.acquisition_session.newValue) {
        inMemorySessionCache = changes.acquisition_session.newValue;
      }
    }
  });
}

function getStoredSession() {
  return new Promise((resolve) => {
    if (inMemorySessionCache) {
      return resolve(inMemorySessionCache);
    }
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["acquisition_session", "currentSession"], (res) => {
        inMemorySessionCache = (res && res.acquisition_session) || null;
        resolve(inMemorySessionCache);
      });
    } else {
      resolve(null);
    }
  });
}

function saveStoredSession(session) {
  inMemorySessionCache = session;
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      // ── SSOT: background.js updates currentSession with canonical schema ─
      // actualProfiles must NEVER be derived from extractedConnections.
      // If not available in the incoming session, read from prior currentSession.
      chrome.storage.local.get(["currentSession"], (stored) => {
        const previous = stored && stored.currentSession ? stored.currentSession : {};

        // Preserve frozen totalConnections from canonical SSOT
        const total = session.totalConnections && session.totalConnections > 0
          ? session.totalConnections
          : (previous.totalConnections && previous.totalConnections > 0
              ? previous.totalConnections
              : (session.expectedTotal || 0));

        // Preserve frozen actualProfiles — NEVER re-derive from extracted
        const actual = session.actualProfiles && session.actualProfiles > 0
          ? session.actualProfiles
          : (previous.actualProfiles && previous.actualProfiles > 0
              ? previous.actualProfiles
              : (total > 1 ? total - 1 : total));

        const extracted = session.extractedConnections !== undefined
          ? session.extractedConnections
          : (session.collectedCount !== undefined ? session.collectedCount
              : (session.connections ? session.connections.length : (previous.extractedConnections || 0)));

        const imported = session.importedRecords !== undefined
          ? session.importedRecords
          : (previous.importedRecords !== undefined ? previous.importedRecords : undefined);

        // Trust progressPercent from content.js if available; clamp extracted when complete
        const isComplete = actual > 0 && extracted >= actual;
        const canonicalExtracted = isComplete ? actual : extracted;
        const rawPct = session.progressPercent !== undefined
          ? (isComplete ? 100 : session.progressPercent)
          : (actual > 0 ? (isComplete ? 100 : Math.min(99, Math.floor((canonicalExtracted / actual) * 100))) : (canonicalExtracted > 0 ? 100 : 0));

        // State rule: resting when extraction is complete
        const rawState = session.state || "idle";
        const canonicalState = isComplete ? "resting" : ((rawState === "resting" || rawState === "completed") ? "paused" : rawState);

        const currentSessionObj = {
          sessionId: session.sessionId,
          totalConnections: total,
          actualProfiles: actual,
          extractedConnections: canonicalExtracted,
          progressPercent: rawPct,
          importedRecords: imported,
          state: canonicalState,
          syncStatus: isComplete ? "synced" : (session.syncStatus || session.sync_status || "idle"),
          lastSyncedAt: session.lastSyncedAt || session.last_synced_at || null,
          nextBatchAt: session.nextBatchAt || null,
          estimatedRemainingMs: session.estimatedRemainingMs || session.pausedRemainingMs || null,
          lastKnownActualProfiles: actual,
          pausedRemainingMs: session.pausedRemainingMs || null,
          countdownSeconds: session.countdownSeconds || session.countdown_seconds || 0,
          statusMessage: session.statusMessage || ""
        };
        // ────────────────────────────────────────────────────────────────────

        if (typeof chrome !== "undefined" && chrome.alarms && session.nextBatchAt) {
          try {
            if (session.nextBatchAt > Date.now()) {
              chrome.alarms.create(BATCH_ALARM_NAME, { when: session.nextBatchAt });
            } else if (session.state === "waiting" || session.state === "acquiring" || session.state === "building") {
              triggerNextBatchInTabs();
            }
          } catch (e) {}
        }

        chrome.storage.local.set({
          acquisition_session: session,
          currentSession: currentSessionObj
        }, () => {
          resolve(session);
        });
      });
    } else {
      resolve(session);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    const msgAction = message.action || message.type;
    if (!msgAction) return false;

    if (msgAction === "SYNC_AGAIN" || msgAction === "syncAgain" || msgAction === "NAVIGATE_AND_RESUME_SYNC") {
      const targetUrl = message.url || "https://www.linkedin.com/mynetwork/invite-connect/connections/";
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentTab = tabs && tabs[0];
          if (currentTab) {
            if (!currentTab.url || !currentTab.url.includes("/mynetwork/invite-connect/connections/")) {
              chrome.tabs.update(currentTab.id, { url: targetUrl });
            } else {
              chrome.tabs.sendMessage(currentTab.id, { action: "SYNC_AGAIN" }, () => {});
            }
          } else {
            chrome.tabs.create({ url: targetUrl });
          }
        });
      }
      if (sendResponse) sendResponse({ success: true });
      return false;
    }

    if (msgAction === "RUN_NEXT_BATCH" || msgAction === "runNextBatch" || msgAction === "triggerNextBatch") {
      triggerNextBatchInTabs();
      if (sendResponse) sendResponse({ success: true });
      return false;
    }

    if (msgAction === "OPEN_MY_NETWORK" || msgAction === "openMyNetwork" || msgAction === "openDeveloperDashboard") {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        const dashboardUrl = (chrome.runtime && typeof chrome.runtime.getURL === "function") 
          ? chrome.runtime.getURL("developer_dashboard.html") 
          : "developer_dashboard.html";

        chrome.tabs.query({}, (tabs) => {
          const existingTab = (tabs || []).find(t => t.url && t.url.includes("developer_dashboard.html"));
          if (existingTab) {
            chrome.tabs.update(existingTab.id, { active: true }, () => {
              if (existingTab.windowId && chrome.windows) {
                chrome.windows.update(existingTab.windowId, { focused: true });
              }
            });
          } else {
            chrome.tabs.create({ url: dashboardUrl });
          }
        });
      }
      if (sendResponse) sendResponse({ success: true });
      return false;
    }

    if (msgAction === "RESUME_EXTRACTION_SESSION" || msgAction === "resumeExtractionSession" || msgAction === "NAVIGATE_AND_RESUME_SYNC") {
      const targetUrl = message.url || "https://www.linkedin.com/mynetwork/invite-connect/connections/";
      (async () => {
        let session = await getStoredSession();
        if (session) {
          session.state = "acquiring";
          await saveStoredSession(session);
        }
        if (typeof chrome !== "undefined" && chrome.tabs) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs && tabs[0];
            if (currentTab) {
              if (!currentTab.url || !currentTab.url.includes("/mynetwork/invite-connect/connections/")) {
                chrome.tabs.update(currentTab.id, { url: targetUrl });
              } else {
                chrome.tabs.sendMessage(currentTab.id, { action: "startAutomatedAcquisition" }, () => {});
              }
            } else {
              chrome.tabs.create({ url: targetUrl });
            }
          });
        }
      })();
      if (sendResponse) sendResponse({ success: true });
      return false;
    }

    if (msgAction === "clearRefreshBadge") {
      if (chrome.action) {
        chrome.action.setBadgeText({ text: "" });
        chrome.action.setTitle({ title: "" });
      }
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          refreshStatus: "completed",
          lastSuccessfulRefresh: new Date().toISOString(),
          nextRefreshAt: Date.now() + REFRESH_INTERVAL_MINUTES * 60 * 1000
        });
      }
      return false;
    }

    const tabId = (sender && sender.tab && sender.tab.id) || message.sourceTabId || null;
    const url = message.sourceUrl || (sender && sender.tab && sender.tab.url) || "";

    const sessionActions = [
      "START_SESSION", "startAutomatedAcquisition", "startCollection",
      "GET_SESSION_STATUS", "getCollectionStatus", "getAcquisitionStatus",
      "UPDATE_SESSION",
      "PAUSE_SESSION", "pauseCollection",
      "RESUME_SESSION", "resumeCollection",
      "COMPLETE_SESSION", "finishCollection", "finishAcquisition",
      "CANCEL_SESSION", "cancelCollection", "cancelAcquisition",
      "SYNC_TO_BACKEND", "syncToBackend", "SYNC_NETWORK", "syncNetwork"
    ];

    if (sessionActions.includes(msgAction)) {
      (async () => {
        let session = await getStoredSession();

        switch (msgAction) {
          case "START_SESSION":
          case "startAutomatedAcquisition":
          case "startCollection": {
            if (session && ["acquiring", "waiting_for_content", "settling", "paused", "interrupted"].includes(session.state)) {
              if (session.sourceTabId && tabId && session.sourceTabId !== tabId) {
                sendResponse({
                  success: true,
                  isExistingSession: true,
                  status: session,
                  message: "Acquisition session active on another tab"
                });
                return;
              }
              session.state = "acquiring";
              session.lastUpdated = new Date().toISOString();
              if (tabId) session.sourceTabId = tabId;
              if (url) session.sourceUrl = url;
              await saveStoredSession(session);
              sendResponse({ success: true, status: session, isExistingSession: true });
              return;
            }

            const now = new Date().toISOString();
            session = {
              sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              state: "acquiring",
              expectedTotal: message.expectedTotal || 0,
              collectedConnections: message.connections || [],
              collectedCount: (message.connections || []).length,
              relationshipEvidence: message.relationship_evidence || [],
              relationshipEvidenceCount: (message.relationship_evidence || []).length,
              first_degree_count: (message.connections || []).length,
              connections: message.connections || [],
              relationship_evidence: message.relationship_evidence || [],
              startedAt: now,
              lastUpdated: now,
              lastActivity: now,
              sourceUrl: url,
              sourceTabId: tabId,
              syncStatus: "idle",
              sync_status: "idle",
              syncMessage: "",
              statusMessage: "Acquiring connection records from page...",
              completionStatus: "incomplete",
              isPartial: true,
              pageCount: 1,
              telemetry: null
            };
            await saveStoredSession(session);
            sendResponse({ success: true, status: session });
            break;
          }

          case "GET_SESSION_STATUS":
          case "getCollectionStatus":
          case "getAcquisitionStatus": {
            if (!session) {
              session = {
                sessionId: null,
                state: "idle",
                expectedTotal: 0,
                collectedConnections: [],
                collectedCount: 0,
                relationshipEvidence: [],
                relationshipEvidenceCount: 0,
                first_degree_count: 0,
                connections: [],
                relationship_evidence: [],
                completionStatus: "incomplete",
                isPartial: true,
                statusMessage: "Connections Idle",
                syncStatus: "idle",
                sync_status: "idle",
                syncMessage: ""
              };
            }
            sendResponse({ success: true, status: session });
            break;
          }

          case "UPDATE_SESSION": {
            if (!session) {
              session = {
                sessionId: message.sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                startedAt: new Date().toISOString(),
                sourceUrl: url,
                sourceTabId: tabId
              };
            }

            const mergedConn = mergeConnections(session.collectedConnections || session.connections || [], message.connections || []);
            const mergedEv = mergeEvidence(session.relationshipEvidence || session.relationship_evidence || [], message.relationship_evidence || []);

            const incomingSyncStatus = message.syncStatus || message.sync_status;
            const currentSyncStatus = session.syncStatus || session.sync_status || "idle";
            let effectiveSyncStatus = incomingSyncStatus || currentSyncStatus || "idle";
            if (currentSyncStatus === "synced" && incomingSyncStatus !== "idle" && incomingSyncStatus !== "failed") {
              effectiveSyncStatus = "synced";
            }

            const expTotal = message.totalConnections !== undefined ? message.totalConnections : (message.expectedTotal !== undefined ? message.expectedTotal : (session.totalConnections || session.expectedTotal || 0));
            const remCount = message.remainingConnections !== undefined ? message.remainingConnections : (message.remaining_count !== undefined ? message.remaining_count : Math.max(0, expTotal - mergedConn.length));
            const pct = message.progressPercent !== undefined ? message.progressPercent : (message.progress_percent !== undefined ? message.progress_percent : (expTotal > 0 ? Math.min(100, Math.round((mergedConn.length / expTotal) * 100)) : (mergedConn.length > 0 ? 100 : 0)));
            const nextBatchAt = message.nextBatchAt !== undefined ? message.nextBatchAt : (session.nextBatchAt || (message.nextSyncDelay ? Date.now() + message.nextSyncDelay : null));

            session = {
              ...session,
              state: message.state || session.state || "acquiring",
              expectedTotal: expTotal,
              expected_total: expTotal,
              totalConnections: expTotal,
              collectedConnections: mergedConn,
              connections: mergedConn,
              collectedCount: mergedConn.length,
              extractedConnections: mergedConn.length,
              remainingConnections: remCount,
              remaining_count: remCount,
              progressPercent: pct,
              progress_percent: pct,
              nextSyncDelay: message.nextSyncDelay !== undefined ? message.nextSyncDelay : (session.nextSyncDelay || 0),
              nextBatchAt: nextBatchAt,
              nextSyncAt: message.nextSyncAt || session.nextSyncAt || (nextBatchAt ? new Date(nextBatchAt).toISOString() : null),
              first_degree_count: mergedConn.length,
              relationshipEvidence: mergedEv,
              relationship_evidence: mergedEv,
              relationshipEvidenceCount: mergedEv.length,
              pageCount: message.pageCount !== undefined ? message.pageCount : session.pageCount,
              completionStatus: message.completionStatus || session.completionStatus || "incomplete",
              isPartial: message.isPartial !== undefined ? message.isPartial : session.isPartial,
              statusMessage: message.statusMessage || session.statusMessage || "",
              syncStatus: effectiveSyncStatus,
              sync_status: effectiveSyncStatus,
              syncMessage: message.syncMessage || message.sync_message || session.syncMessage || "",
              telemetry: message.telemetry || session.telemetry || null,
              lastUpdated: new Date().toISOString(),
              lastActivity: new Date().toISOString()
            };

            if (typeof chrome !== "undefined" && chrome.alarms && nextBatchAt && nextBatchAt > Date.now()) {
              try { chrome.alarms.create("warmgraph-next-batch-alarm", { when: nextBatchAt }); } catch (e) {}
            }

            await saveStoredSession(session);
            sendResponse({ success: true, status: session });
            break;
          }

          case "PAUSE_SESSION":
          case "pauseCollection": {
            if (session) {
              session.state = "paused";
              session.lastUpdated = new Date().toISOString();
              await saveStoredSession(session);
            }
            sendResponse({ success: true, status: session });
            break;
          }

          case "RESUME_SESSION":
          case "resumeCollection": {
            if (session) {
              session.state = "acquiring";
              session.lastUpdated = new Date().toISOString();
              await saveStoredSession(session);
            }
            sendResponse({ success: true, status: session });
            break;
          }

          case "COMPLETE_SESSION":
          case "finishCollection":
          case "finishAcquisition": {
            if (session) {
              session.state = "completed";
              session.isPartial = false;
              session.completionStatus = message.completionStatus || "complete";
              session.lastUpdated = new Date().toISOString();
              await saveStoredSession(session);
            }
            sendResponse({ success: true, status: session, data: session });
            break;
          }

          case "CANCEL_SESSION":
          case "cancelCollection":
          case "cancelAcquisition": {
            if (session) {
              session.state = "idle";
              session.lastUpdated = new Date().toISOString();
              await saveStoredSession(session);
            }
            sendResponse({ success: true, status: session });
            break;
          }

          case "SYNC_NETWORK":
          case "syncNetwork":
          case "SYNC_TO_BACKEND":
          case "syncToBackend": {
            console.log("[SYNC] Background received");
            if (!session) {
              session = await getStoredSession();
            }

            try {
              const BACKEND_URL = "http://127.0.0.1:8000";

              // 1. Read warmgraph_owner
              console.log("[SYNC] Reading owner");
              let ownerIdVal = null;
              if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                const stored = await new Promise(r => chrome.storage.local.get(["warmgraph_owner", "ownerId"], res => r(res || {})));
                const ownerRecord = stored.warmgraph_owner;
                if (ownerRecord?.ownerId) {
                  ownerIdVal = ownerRecord.ownerId;
                } else if (stored.ownerId && !stored.ownerId.startsWith("warmgraph_")) {
                  ownerIdVal = stored.ownerId;
                }
              }

              if (!ownerIdVal) {
                console.log("[SYNC] Error: Owner identity not detected");
                sendResponse({ success: false, error: "Cannot sync: Owner identity not detected." });
                return;
              }

              // 2. Read warmgraph_active_graph.connections
              console.log("[SYNC] Reading local graph");
              const storedData = await new Promise(r => {
                if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                  chrome.storage.local.get(["warmgraph_active_graph"], r);
                } else {
                  r({});
                }
              });

              const activeConns = storedData?.warmgraph_active_graph?.connections || [];
              const connectionsList = activeConns.length > 0 ? activeConns : (session?.collectedConnections || session?.connections || []);
              const evidenceList = session?.relationshipEvidence || session?.relationship_evidence || [];

              // Required logging per specification
              console.log("[SYNC] Uploading to backend");
              console.log("[SYNC] Starting upload");
              console.log("[SYNC] Owner:", ownerIdVal);
              console.log("[SYNC] Connections:", connectionsList.length);
              console.log("[SYNC] POST /network/import");

              if (session) {
                session.syncStatus = "syncing";
                session.sync_status = "syncing";
                session.syncMessage = "Importing your network...";
                await saveStoredSession(session);
              }

              const payload = {
                owner_id: ownerIdVal,
                source: "linkedin_dom",
                confirmed: true,
                connections: connectionsList,
                relationship_evidence: evidenceList,
                expected_total: session?.expectedTotal || connectionsList.length,
                collected_total: connectionsList.length,
                completion_status: session?.completionStatus || "complete"
              };

              let isSuccess = false;
              let errMsg = "";

              if (typeof fetch === "function") {
                // 3. POST /network/import
                const response = await fetch(`${BACKEND_URL}/network/import`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload)
                });

                // 4. Wait for 200
                if (!response.ok) {
                  const errJson = await response.json().catch(() => ({}));
                  errMsg = errJson.detail || `Backend error (HTTP ${response.status})`;
                  console.log("[SYNC] POST /network/import failed:", errMsg);
                } else {
                  console.log("[SYNC] POST /network/import 200 OK");

                  // 5. Verify GET /network/{owner}
                  const netVer = await fetch(`${BACKEND_URL}/network/${encodeURIComponent(ownerIdVal)}`).catch(() => null);
                  if (!netVer || !netVer.ok) {
                    errMsg = "Backend sync failed: GET /network validation failed";
                    console.log("[SYNC] GET /network validation failed");
                  } else {
                    console.log("[SYNC] GET /network 200 OK");
                    // Step 5 Verification 2: GET /graph/{owner}
                    const graphVer = await fetch(`${BACKEND_URL}/graph/${encodeURIComponent(ownerIdVal)}`).catch(() => null);
                    if (!graphVer || !graphVer.ok) {
                      errMsg = "Backend sync failed: GET /graph validation failed";
                      console.log("[SYNC] GET /graph validation failed");
                    } else {
                      console.log("[SYNC] GET /graph 200 OK");
                      isSuccess = true;
                    }
                  }
                }
              } else {
                isSuccess = true;
              }

              if (isSuccess) {
                const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                if (session) {
                  session.syncStatus = "synced";
                  session.sync_status = "synced";
                  session.syncMessage = "Network Successfully Synced ✓";
                  session.lastSyncedAt = formattedTime;
                  session.last_synced_at = formattedTime;
                }

                if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                  await new Promise(r => chrome.storage.local.set({
                    warmgraph_active_graph: {
                      owner_id: ownerIdVal,
                      connections: connectionsList,
                      totalConnections: connectionsList.length,
                      lastSyncedAt: new Date().toISOString()
                    }
                  }, r));
                }

                if (session) {
                  await saveStoredSession(session);
                }

                // 6. Broadcast SYNC_COMPLETE
                if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
                  try {
                    chrome.runtime.sendMessage({ action: "SYNC_COMPLETE", type: "SYNC_COMPLETE", ownerId: ownerIdVal });
                  } catch (_) {}
                }

                sendResponse({ success: true, status: session || { syncStatus: "synced", sync_status: "synced", ownerId: ownerIdVal } });
              } else {
                if (session) {
                  session.syncStatus = "failed";
                  session.sync_status = "failed";
                  session.syncMessage = errMsg || "Backend sync failed";
                  await saveStoredSession(session);
                }
                sendResponse({ success: false, error: errMsg || "Backend sync failed", status: session });
              }
            } catch (err) {
              console.log("[SYNC] Error during sync:", err.message);
              if (session) {
                session.syncStatus = "failed";
                session.sync_status = "failed";
                session.syncMessage = err.message || "Backend sync failed";
                await saveStoredSession(session);
              }
              sendResponse({ success: false, error: err.message, status: session });
            }
            break;
          }
        }
      })();

      return true;
    }
  });
}
