// =========================================================
// TASK 8.3 — PRODUCTION NETWORK RECONCILIATION ENGINE TESTS
// =========================================================

const fs = require("fs");
const path = require("path");
const assert = require("assert");

class MockChromeStorage {
  constructor() {
    this.store = {};
    this.listeners = [];
  }
  get(keys, cb) {
    const res = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    keyList.forEach(k => { if (this.store[k] !== undefined) res[k] = this.store[k]; });
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
  onChanged = { addListener: (fn) => this.listeners.push(fn) };
}

class MockChromeAlarms {
  constructor() {
    this.alarms = {};
    this.listeners = [];
  }
  create(name, algo) {
    this.alarms[name] = algo;
  }
  clear(name, cb) {
    delete this.alarms[name];
    if (cb) cb(true);
  }
  onAlarm = { addListener: (fn) => this.listeners.push(fn) };
  trigger(name) {
    this.listeners.forEach(l => l({ name }));
  }
}

function createMockElement(tag = "div") {
  const children = [];
  return {
    tagName: tag.toUpperCase(), style: { display: "block" }, className: "", id: "", children,
    _textContent: "",
    get textContent() { return this._textContent !== undefined ? String(this._textContent) : children.map(c => c.textContent).join(" "); },
    set textContent(v) { this._textContent = v; },
    get innerText() { return String(this._textContent || ""); },
    set innerText(v) { this._textContent = v; },
    appendChild: (c) => { children.push(c); c.parentElement = null; },
    removeChild: (c) => { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, setAttribute: () => {},
    addEventListener: () => {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0 })
  };
}

async function runTask83Tests() {
  console.log("=================================================");
  console.log("RUNNING TASK 8.3 NETWORK RECONCILIATION TESTS");
  console.log("=================================================\n");

  const storage = new MockChromeStorage();
  const alarms = new MockChromeAlarms();
  const messageListeners = [];
  const installedListeners = [];

  global.chrome = {
    storage: { local: storage, onChanged: storage.onChanged },
    alarms,
    runtime: {
      sendMessage: (msg, cb) => {
        messageListeners.forEach(l => { try { l(msg, {}, cb || (() => {})); } catch (e) {} });
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onInstalled: { addListener: (fn) => { installedListeners.push(fn); fn(); } },
      getURL: (f) => `chrome-extension://test/${f}`,
      lastError: null
    },
    tabs: {
      query: (q, cb) => {
        cb([{ id: 101, url: "https://www.linkedin.com/mynetwork/invite-connect/connections/" }]);
      },
      sendMessage: (tabId, msg, cb) => {
        messageListeners.forEach(l => { try { l(msg, {}, cb || (() => {})); } catch (e) {} });
      }
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} }
  };

  class MockMutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() {} disconnect() {}
  }
  global.MutationObserver = MockMutationObserver;

  const mockBody = createMockElement("body");
  mockBody.textContent = "Connections (208)";
  const mockDoc = {
    body: mockBody, documentElement: mockBody, head: createMockElement("head"),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [mockBody],
    createElement: (tag) => createMockElement(tag), addEventListener: () => {}, visibilityState: "visible"
  };

  global.window = {
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/", pathname: "/mynetwork/invite-connect/connections/" },
    document: mockDoc, addEventListener: () => {}, dispatchEvent: () => {},
    scrollY: 0, pageYOffset: 0, innerHeight: 800, scrollBy: () => {},
    getComputedStyle: () => ({ overflowY: "auto" }), TEST_ACQUISITION_DELAY_MS: 100
  };
  global.document = mockDoc;

  eval(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "background.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "overlay.js"), "utf8"));

  const session = global.window.acquisitionSession || acquisitionSession;
  let passedCount = 0;

  // ── TEST 1: URL Normalization & Duplicate Safety ───────────────────────────
  console.log("[TEST 1] URL Normalization & Duplicate Safety...");
  
  const norm1 = normalizeProfileUrl("https://www.linkedin.com/in/john-doe?miniProfileUrn=urn%3Ali%3A&trackingId=123/");
  const norm2 = normalizeProfileUrl("https://www.linkedin.com/in/JOHN-DOE/");
  assert.strictEqual(norm1, "https://www.linkedin.com/in/john-doe", "Normalize strips query params & trailing slash");
  assert.strictEqual(norm2, "https://www.linkedin.com/in/john-doe", "Normalize lower-cases pathname");
  assert.strictEqual(norm1, norm2, "Both normalized URLs match for duplicate safety");
  console.log("✓ TEST 1 PASSED: Duplicate safety URL normalization verifies john-doe match");
  passedCount++;

  // ── TEST 2: Network Reconciliation Case A — Equal (Skip Sync) ───────────────
  console.log("\n[TEST 2] Reconciliation Case A — Equal Header Count (Skip Sync)...");

  mockBody.textContent = "Connections (208)";
  session.totalConnections = 208;
  session.actualProfiles = 207;
  for (let i = 1; i <= 207; i++) {
    session.connections.set(`url:user-${i}`, { name: `User ${i}`, profile_url: `https://www.linkedin.com/in/user-${i}` });
  }
  session.state = "resting";

  const recA = await session.reconcileNetworkWithDom();
  assert.strictEqual(recA.action, "skip", "Equal count MUST return skip action");
  assert.strictEqual(session.state, "resting", "State MUST remain resting");
  assert.ok(session.statusMessage.includes("caught up"), "Status message MUST indicate user is caught up");
  console.log("✓ TEST 2 PASSED: Equal header (207 live vs 207 stored) skips sync with Resting state");
  passedCount++;

  // ── TEST 3: Network Reconciliation Case B — Higher (Incremental Sync) ──────
  console.log("\n[TEST 3] Reconciliation Case B — Higher Header Count (Incremental Sync)...");

  session.totalConnections = 208;
  session.actualProfiles = 207;
  mockBody.textContent = "Connections (214)"; // live actual = 213 (diff = 6)

  const recB = await session.reconcileNetworkWithDom();
  assert.strictEqual(recB.action, "incremental", "Higher count MUST return incremental action");
  assert.strictEqual(recB.diff, 6, "Incremental diff MUST be 6 (213 - 207)");
  assert.strictEqual(session.actualProfiles, 213, "actualProfiles updated to 213");
  assert.strictEqual(session.connections.size, 207, "Previous 207 connections preserved without clearing");
  console.log("✓ TEST 3 PASSED: Higher header (213 live vs 207 stored) performs incremental sync for 6 new");
  passedCount++;

  // ── TEST 4: Network Reconciliation Case C — Lower (Full Rebuild) ───────────
  console.log("\n[TEST 4] Reconciliation Case C — Lower Header Count (Full Rebuild)...");

  session.totalConnections = 214;
  session.actualProfiles = 213;
  mockBody.textContent = "Connections (195)"; // live actual = 194

  const recC = await session.reconcileNetworkWithDom();
  assert.strictEqual(recC.action, "rebuild", "Lower count MUST return rebuild action");
  assert.strictEqual(session.actualProfiles, 194, "actualProfiles updated to 194");
  assert.strictEqual(session.connections.size, 0, "Connections map cleared for clean rebuild");
  assert.ok(session.statusMessage.includes("network changed"), "Status message indicates network changed");
  console.log("✓ TEST 4 PASSED: Lower header (194 live vs 213 stored) triggers clean rebuild");
  passedCount++;

  // ── TEST 5: Estimated Time Remaining & Weekly Warmup Scheduler ────────────
  console.log("\n[TEST 5] Estimated Time Remaining & Weekly Warmup Alarm...");

  session.actualProfiles = 207;
  session.connections.clear();
  for (let i = 1; i <= 50; i++) {
    session.connections.set(`url:user-${i}`, { name: `User ${i}`, profile_url: `https://www.linkedin.com/in/user-${i}` });
  }
  session.estimatedRemainingMs = 32000;
  session.checkpointSessionSync();

  const storedSession = storage.store["currentSession"];
  assert.strictEqual(storedSession.estimatedRemainingMs, 32000, "estimatedRemainingMs persisted in canonical SSOT");

  assert.ok(alarms.alarms["warmgraph-weekly-warmup"], "Weekly warmup alarm 'warmgraph-weekly-warmup' registered");
  console.log("✓ TEST 5 PASSED: estimatedRemainingMs (~32 sec left) and weekly warmup alarm verified");
  passedCount++;

  console.log("\n=================================================");
  if (passedCount === 5) {
    console.log("ALL TASK 8.3 VERIFICATION TESTS PASSED!");
  } else {
    console.log(`${passedCount}/5 TESTS PASSED`);
    process.exit(1);
  }
  console.log("=================================================\n");
}

runTask83Tests().catch(err => {
  console.error("Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
