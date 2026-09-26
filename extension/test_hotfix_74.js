/**
 * Acceptance Test Suite for TASK 7.4.1 (Single Source of Truth & Hero Metric Consistency)
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// Mock Chrome Extension APIs
class MockChromeStorage {
  constructor() {
    this.store = {};
    this.listeners = [];
  }
  get(keys, cb) {
    const res = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    keyList.forEach(k => {
      if (this.store[k] !== undefined) res[k] = this.store[k];
    });
    if (cb) cb(res);
    return Promise.resolve(res);
  }
  set(obj, cb) {
    const changes = {};
    Object.keys(obj).forEach(k => {
      changes[k] = { oldValue: this.store[k], newValue: obj[k] };
      this.store[k] = obj[k];
    });
    this.listeners.forEach(l => l(changes, "local"));
    if (cb) cb();
    return Promise.resolve();
  }
  onChanged = {
    addListener: (fn) => this.listeners.push(fn)
  };
}

class MockChromeTabs {
  constructor() {
    this.tabs = [];
  }
  query(queryObj, cb) {
    let res = [...this.tabs];
    if (queryObj.url) {
      res = res.filter(t => t.url && t.url.includes("developer_dashboard.html"));
    }
    if (cb) cb(res);
    return Promise.resolve(res);
  }
  update(tabId, updateProps, cb) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      Object.assign(tab, updateProps);
    }
    if (cb) cb(tab);
    return Promise.resolve(tab);
  }
  create(createProps, cb) {
    const newTab = { id: Math.floor(Math.random() * 10000), ...createProps, active: true };
    this.tabs.push(newTab);
    if (cb) cb(newTab);
    return Promise.resolve(newTab);
  }
}

class MockChromeWindows {
  update(windowId, updateProps, cb) {
    if (cb) cb();
    return Promise.resolve();
  }
}

class MockChromeRuntime {
  constructor() {
    this.messageListeners = [];
  }
  getURL(pathStr) {
    return `chrome-extension://mock_id/${pathStr}`;
  }
  onMessage = {
    addListener: (fn) => this.messageListeners.push(fn)
  };
  sendMessage(msg, cb) {
    let handled = false;
    this.messageListeners.forEach(l => {
      const res = l(msg, { tab: { id: 1, url: "https://www.linkedin.com/mynetwork/invite-connect/connections/" } }, (resp) => {
        handled = true;
        if (cb) cb(resp);
      });
      if (res === true) handled = true;
    });
    if (!handled && cb) cb({ success: true });
  }
}

global.chrome = {
  storage: { local: new MockChromeStorage() },
  tabs: new MockChromeTabs(),
  windows: new MockChromeWindows(),
  runtime: new MockChromeRuntime(),
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} }
};

// Load background code
const backgroundPath = path.join(__dirname, "background.js");
const backgroundCode = fs.readFileSync(backgroundPath, "utf8");
eval(backgroundCode);

function parseHTMLToMockNodes(htmlStr, createElementFn) {
  const root = createElementFn("div");
  const stack = [root];
  const tagRegex = /<\/?([a-z1-6]+)([^>]*)>|([^<]+)/gi;
  let match;

  while ((match = tagRegex.exec(htmlStr)) !== null) {
    const full = match[0];
    const tagName = match[1];
    const attrs = match[2];
    const text = match[3];

    if (text) {
      const trimmed = text.trim();
      if (trimmed && stack.length > 0) {
        const cur = stack[stack.length - 1];
        cur._textContent = (cur._textContent ? cur._textContent + " " : "") + trimmed;
      }
    } else if (full.startsWith("</")) {
      if (stack.length > 1) {
        stack.pop();
      }
    } else if (full.startsWith("<")) {
      const child = createElementFn(tagName);
      if (attrs) {
        const idM = attrs.match(/id=["']([^"']+)["']/i);
        if (idM) child.id = idM[1];
        const clsM = attrs.match(/class=["']([^"']+)["']/i);
        if (clsM) child.className = clsM[1];
      }
      stack[stack.length - 1].appendChild(child);
      if (!full.endsWith("/>") && !["img", "hr", "br", "input"].includes(tagName.toLowerCase())) {
        stack.push(child);
      }
    }
  }
  return root;
}

function createMockElement(tag = "div") {
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    style: { display: "block" },
    className: "",
    id: "",
    children: children,
    _textContent: "",
    _innerHTML: "",
    get textContent() {
      if (this._textContent) return this._textContent;
      return children.map(c => c.textContent).join(" ");
    },
    set textContent(val) {
      this._textContent = val;
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(val) {
      this._innerHTML = val;
      children.length = 0;
      const parsed = parseHTMLToMockNodes(val, createMockElement);
      parsed.children.forEach(c => this.appendChild(c));
    },
    appendChild: (child) => {
      children.push(child);
      child.parentElement = el;
    },
    querySelector: (sel) => {
      const match = (item) => {
        if (!item) return false;
        if (sel.startsWith("#") && item.id === sel.slice(1)) return true;
        if (sel.startsWith(".") && item.className && item.className.includes(sel.slice(1))) return true;
        if (item.tagName === sel.toUpperCase()) return true;
        return false;
      };
      const search = (node) => {
        if (match(node)) return node;
        for (const child of node.children || []) {
          const res = search(child);
          if (res) return res;
        }
        return null;
      };
      return search(el);
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  return el;
}

async function runHotfixTests() {
  console.log("=================================================");
  console.log("RUNNING TASK 7.4.1 SINGLE SOURCE OF TRUTH TESTS");
  console.log("=================================================");

  // TEST 1: OPEN_MY_NETWORK tab focusing (no duplicate tabs)
  console.log("\n[TEST 1] Open My Network tab focus logic...");
  
  global.chrome.runtime.sendMessage({ action: "OPEN_MY_NETWORK" });
  assert.strictEqual(global.chrome.tabs.tabs.length, 1, "Should create 1 tab for developer_dashboard.html");
  assert.strictEqual(global.chrome.tabs.tabs[0].url, "chrome-extension://mock_id/developer_dashboard.html");
  
  global.chrome.tabs.tabs[0].active = false;
  global.chrome.runtime.sendMessage({ action: "OPEN_MY_NETWORK" });
  assert.strictEqual(global.chrome.tabs.tabs.length, 1, "Should NOT create duplicate tabs!");
  assert.strictEqual(global.chrome.tabs.tabs[0].active, true, "Existing tab should be activated");
  console.log("✓ TEST 1 PASSED: Open My Network focuses existing tab without duplicates");

  // TEST 2: Unified storage schema (currentSession.actualProfiles === extractedConnections when resting)
  console.log("\n[TEST 2] Unified Storage Schema persistence & actualProfiles calculation...");
  
  const testSession = {
    sessionId: "warmgraph_session_12345",
    state: "completed",
    expectedTotal: 208,
    collectedCount: 207,
    extractedConnections: 207,
    progressPercent: 100,
    syncStatus: "synced",
    lastSyncDate: "Today"
  };

  await saveStoredSession(testSession);
  
  const storageData = await global.chrome.storage.local.get(["acquisition_session", "currentSession"]);
  assert(storageData.acquisition_session, "acquisition_session key should exist");
  assert(storageData.currentSession, "currentSession key should exist");
  
  assert.strictEqual(storageData.currentSession.extractedConnections, 207, "currentSession.extractedConnections should be 207");
  assert.strictEqual(storageData.currentSession.actualProfiles, 207, "currentSession.actualProfiles should be 207 when resting/completed");
  assert.strictEqual(storageData.currentSession.totalConnections, 208, "currentSession.totalConnections should be 208");
  assert.strictEqual(storageData.currentSession.progressPercent, 100, "currentSession.progressPercent should be 100%");
  console.log("✓ TEST 2 PASSED: Storage contains synchronized currentSession with actualProfiles = 207");

  // TEST 3: Overlay 207 / 207 Hero Metric & Resting State Verification
  console.log("\n[TEST 3] Verification of Overlay 207 / 207 Hero metric and Resting state...");
  
  const mockBody = createMockElement("body");
  const mockDoc = {
    body: mockBody,
    head: createMockElement("head"),
    getElementById: (id) => mockBody.querySelector(`#${id}`),
    querySelector: (sel) => mockBody.querySelector(sel),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
    addEventListener: () => {}
  };

  global.window = {
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/" },
    document: mockDoc,
    addEventListener: () => {},
    dispatchEvent: () => {}
  };
  global.document = mockDoc;

  const overlayPath = path.join(__dirname, "overlay.js");
  const overlayCode = fs.readFileSync(overlayPath, "utf8");
  eval(overlayCode);

  window.WarmGraphOverlay.update({
    state: "completed",
    extractedConnections: 207,
    totalConnections: 208,
    actualProfiles: 207,
    remainingConnections: 0,
    sync_status: "synced"
  });

  const statusPill = mockDoc.querySelector("#warmgraph-status-pill");
  assert(statusPill, "Status pill should exist");
  assert.strictEqual(statusPill.textContent.trim(), "Resting", "Badge text should be 'Resting'");
  assert(statusPill.className.includes("warmgraph-status-resting"), "Status pill class should include warmgraph-status-resting");

  const heroMetric = mockDoc.querySelector("#warmgraph-hero-metric");
  assert(heroMetric, "Hero metric element should exist");
  assert.strictEqual(heroMetric.textContent.trim(), "207 / 207", "Hero metric MUST be '207 / 207', never '207 / 208' or '40 / 208'");

  const heroPercent = mockDoc.querySelector("#warmgraph-hero-percent");
  assert.strictEqual(heroPercent.textContent.trim(), "100%", "Hero percent should be '100%'");

  const heroRemaining = mockDoc.querySelector("#warmgraph-hero-remaining");
  assert.strictEqual(heroRemaining.textContent.trim(), "All LinkedIn connections mapped", "Hero remaining subtitle should be 'All LinkedIn connections mapped'");
  console.log("✓ TEST 3 PASSED: Overlay hero metric renders exact 207 / 207 and 100%");

  // TEST 4: Task 7.4.2 Schema Verification (Imported Records 40 vs Network Size 207/208)
  console.log("\n[TEST 4] Task 7.4.2 Schema Verification (Imported Records 40 vs LinkedIn Network 207)...");
  
  const productionSession = {
    sessionId: "warmgraph_prod_session",
    state: "completed",
    totalConnections: 208,
    actualProfiles: 207,
    extractedConnections: 207,
    importedRecords: 40,
    progressPercent: 100,
    syncStatus: "synced",
    lastSyncDate: "Today"
  };

  await saveStoredSession(productionSession);
  const stored = await global.chrome.storage.local.get(["currentSession"]);
  assert.strictEqual(stored.currentSession.importedRecords, 40, "currentSession.importedRecords should be 40");
  assert.strictEqual(stored.currentSession.actualProfiles, 207, "currentSession.actualProfiles should be 207");
  assert.strictEqual(stored.currentSession.extractedConnections, 207, "currentSession.extractedConnections should be 207");

  window.WarmGraphOverlay.update(stored.currentSession);
  const heroMetric4 = mockDoc.querySelector("#warmgraph-hero-metric");
  assert.strictEqual(heroMetric4.textContent.trim(), "207 / 207", "Hero metric MUST be '207 / 207', never '40 / 40' or '40 / 207'");
  console.log("✓ TEST 4 PASSED: Imported records (40) do not pollute Hero metric (207 / 207)");

  console.log("\n=================================================");
  console.log("ALL TASK 7.4.2 VERIFICATION TESTS PASSED!");
  console.log("=================================================");
}

runHotfixTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
