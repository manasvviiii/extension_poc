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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_MINUTES
  });
  chrome.storage.local.set({
    nextRefreshAt: Date.now() + REFRESH_INTERVAL_MINUTES * 60 * 1000,
    refreshStatus: "scheduled"
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM_NAME) return;

  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#0A66C2" });
  chrome.action.setTitle({
    title: "It's been a couple weeks — open LinkedIn to refresh your graph"
  });
  chrome.storage.local.set({ refreshStatus: "available" });
});

// Clear the nudge once the person actually visits LinkedIn again;
// content.js sends this the moment it successfully scans a page.
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "clearRefreshBadge") {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "" });
    chrome.storage.local.set({
      refreshStatus: "completed",
      lastSuccessfulRefresh: new Date().toISOString(),
      nextRefreshAt: Date.now() + REFRESH_INTERVAL_MINUTES * 60 * 1000
    });
  }
});
