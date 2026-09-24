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

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.alarms) {
      chrome.alarms.create(REFRESH_ALARM_NAME, {
        periodInMinutes: REFRESH_INTERVAL_MINUTES
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
    if (namespace === "local" && changes.acquisition_session && changes.acquisition_session.newValue) {
      inMemorySessionCache = changes.acquisition_session.newValue;
    }
  });
}

function getStoredSession() {
  return new Promise((resolve) => {
    if (inMemorySessionCache) {
      return resolve(inMemorySessionCache);
    }
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(["acquisition_session"], (res) => {
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
      chrome.storage.local.set({ acquisition_session: session }, () => {
        resolve(session);
      });
    } else {
      resolve(session);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === "clearRefreshBadge") {
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
      "CANCEL_SESSION", "cancelCollection", "cancelAcquisition"
    ];

    if (sessionActions.includes(message.action)) {
      (async () => {
        let session = await getStoredSession();

        switch (message.action) {
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

            session = {
              ...session,
              state: message.state || session.state || "acquiring",
              expectedTotal: message.expectedTotal !== undefined ? message.expectedTotal : session.expectedTotal,
              collectedConnections: mergedConn,
              connections: mergedConn,
              collectedCount: mergedConn.length,
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
        }
      })();

      return true;
    }
  });
}
