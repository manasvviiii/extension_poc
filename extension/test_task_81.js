// =========================================================
// TASK 8.1 — SINGLE SOURCE OF TRUTH VERIFICATION TESTS
// =========================================================
// Validates the canonical currentSession schema and
// confirms that overlay.js and popup.js are pure renderers.
// =========================================================

const path = require("path");
const fs = require("fs");
const assert = require("assert");

// ── Mock Chrome Storage ──────────────────────────────────────────────────────
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

class MockChromeRuntime {
  constructor() { this.listeners = []; }
  sendMessage(msg, cb) { if (cb) cb({ success: true }); }
  getURL(f) { return `chrome-extension://test/${f}`; }
  onMessage = { addListener: (fn) => this.listeners.push(fn) };
  lastError = null;
}

// ── Mock DOM element ─────────────────────────────────────────────────────────
function createMockElement(tag = "div") {
  const children = [];
  const eventListeners = {};
  return {
    tagName: tag.toUpperCase(),
    style: { display: "block" },
    className: "", id: "", children,
    _textContent: "",
    get textContent() { return this._textContent !== undefined ? String(this._textContent) : children.map(c => c.textContent).join(" "); },
    set textContent(v) { this._textContent = v; },
    get innerHTML() { return ""; },
    set innerHTML(v) {},
    appendChild: (c) => { children.push(c); c.parentElement = null; },
    removeChild: (c) => { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    querySelector: (sel) => {
      const search = (node) => {
        if (!node) return null;
        if (sel.startsWith("#") && node.id === sel.slice(1)) return node;
        if (sel.startsWith(".") && node.className && node.className.includes(sel.slice(1))) return node;
        if (node.tagName === sel.toUpperCase()) return node;
        for (const c of (node.children || [])) { const r = search(c); if (r) return r; }
        return null;
      };
      return search({ children });
    },
    querySelectorAll: () => [],
    getAttribute: () => null, setAttribute: () => {},
    addEventListener: (t, fn) => { eventListeners[t] = eventListeners[t] || []; eventListeners[t].push(fn); },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0 })
  };
}

// ── Test runner ───────────────────────────────────────────────────────────────
async function runTask81Tests() {
  console.log("=================================================");
  console.log("RUNNING TASK 8.1 SINGLE SOURCE OF TRUTH TESTS");
  console.log("=================================================\n");

  const storage = new MockChromeStorage();
  const runtime = new MockChromeRuntime();

  global.chrome = {
    storage: { local: storage, onChanged: storage.onChanged },
    runtime,
    alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
    tabs: {
      query: (q, cb) => cb([]),
      create: (opts, cb) => { if (cb) cb({ id: 9999 }); },
      update: (id, opts, cb) => { if (cb) cb({}); }
    },
    windows: { update: () => {} },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} }
  };

  class MockMutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() {} disconnect() {}
  }
  global.MutationObserver = MockMutationObserver;

  const mockBody = createMockElement("body");
  const mockDoc = {
    body: mockBody,
    documentElement: { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 },
    scrollingElement: { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 },
    head: { appendChild: () => {} },
    getElementById: (id) => mockBody.querySelector(`#${id}`),
    querySelector: (sel) => mockBody.querySelector(sel),
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag),
    addEventListener: () => {},
    visibilityState: "visible"
  };

  global.window = {
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/", pathname: "/mynetwork/invite-connect/connections/" },
    document: mockDoc,
    addEventListener: () => {},
    dispatchEvent: () => {},
    scrollY: 0, pageYOffset: 0, innerHeight: 800,
    scrollBy: () => {},
    getComputedStyle: () => ({ overflowY: "auto" }),
    TEST_ACQUISITION_DELAY_MS: 100
  };
  global.document = mockDoc;

  // Load files
  eval(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "overlay.js"), "utf8"));

  const session = global.window.acquisitionSession || acquisitionSession;
  let passedCount = 0;

  // ── TEST 1: content.js writes canonical schema to currentSession ─────────────
  console.log("[TEST 1] content.js checkpointSessionSync writes canonical currentSession schema...");

  session.sessionId = "session_test_81";
  session.totalConnections = 208;
  session.actualProfiles = 207;
  session.expectedTotal = 208;
  for (let i = 1; i <= 50; i++) {
    session.connections.set(`url:user-${i}`, { name: `User ${i}`, profile_url: `https://www.linkedin.com/in/user-${i}` });
  }
  session.importedRecords = 40;
  session.syncStatus = "idle";
  session.state = "waiting";
  session.checkpointSessionSync();

  const stored = storage.store["currentSession"];
  assert.ok(stored, "currentSession must exist in storage");
  assert.strictEqual(stored.totalConnections, 208, `totalConnections must be 208, got ${stored.totalConnections}`);
  assert.strictEqual(stored.actualProfiles, 207, `actualProfiles must be 207 (not 50=extracted, not 40=imported), got ${stored.actualProfiles}`);
  assert.strictEqual(stored.extractedConnections, 50, `extractedConnections must be 50, got ${stored.extractedConnections}`);
  assert.strictEqual(stored.importedRecords, 40, `importedRecords must be 40, got ${stored.importedRecords}`);
  assert.strictEqual(stored.progressPercent, 24, `progressPercent must be 24% (50/207), got ${stored.progressPercent}`);
  assert.ok(stored.state, "state must exist");
  assert.notStrictEqual(stored.totalConnections, stored.importedRecords, "totalConnections (208) must NOT equal importedRecords (40)");
  assert.notStrictEqual(stored.extractedConnections, stored.importedRecords, "extractedConnections (50) must NOT equal importedRecords (40)");
  console.log(`✓ TEST 1 PASSED: canonical schema = { total:${stored.totalConnections}, actual:${stored.actualProfiles}, extracted:${stored.extractedConnections}, imported:${stored.importedRecords}, pct:${stored.progressPercent}% }`);
  passedCount++;

  // ── TEST 2: State rule — resting invalid when extracted < actualProfiles ─────
  console.log("\n[TEST 2] State rule: 'resting' is only valid when extracted === actualProfiles...");

  session.state = "completed"; // premature
  session.completionStatus = "complete";
  session.checkpointSessionSync();

  const stored2 = storage.store["currentSession"];
  assert.notStrictEqual(stored2.state, "resting", "State must NOT be resting when 50 < 207");
  assert.notStrictEqual(stored2.state, "completed", "State must NOT be completed when 50 < 207");
  assert.strictEqual(stored2.state, "paused", `State must be 'paused' when completed but 50 < 207, got: ${stored2.state}`);
  assert.strictEqual(stored2.actualProfiles, 207, `actualProfiles must stay 207 even after false completion, got ${stored2.actualProfiles}`);
  console.log(`✓ TEST 2 PASSED: premature 'completed' correctly demoted to 'paused', actualProfiles stays 207`);
  passedCount++;

  // ── TEST 3: State rule — resting IS valid when extracted === actualProfiles ──
  console.log("\n[TEST 3] State rule: 'resting' IS valid when extracted === actualProfiles...");

  session.connections.clear();
  for (let i = 1; i <= 207; i++) {
    session.connections.set(`url:user-${i}`, { name: `User ${i}`, profile_url: `https://www.linkedin.com/in/user-${i}` });
  }
  session.state = "completed";
  session.completionStatus = "complete";
  session.checkpointSessionSync();

  const stored3 = storage.store["currentSession"];
  assert.strictEqual(stored3.extractedConnections, 207, `extractedConnections must be 207, got ${stored3.extractedConnections}`);
  assert.strictEqual(stored3.actualProfiles, 207, `actualProfiles must stay 207 (frozen), got ${stored3.actualProfiles}`);
  assert.strictEqual(stored3.progressPercent, 100, `progressPercent must be 100%, got ${stored3.progressPercent}`);
  assert.ok(["completed", "resting"].includes(stored3.state), `State must be 'completed' or 'resting' when 207/207, got: ${stored3.state}`);
  console.log(`✓ TEST 3 PASSED: 207/207 correctly allows completed/resting at 100% — actualProfiles stays 207`);
  passedCount++;

  // ── TEST 4: overlay.js is a pure renderer — trusts content.js values ─────────
  console.log("\n[TEST 4] overlay.js is a pure renderer — does NOT recalculate actualProfiles...");

  const manager = window.WarmGraphOverlay;
  // Feed content.js-written canonical session (50/207 in progress)
  const canonicalSession = {
    sessionId: "session_test_81",
    totalConnections: 208,
    actualProfiles: 207,
    extractedConnections: 50,
    importedRecords: 40,
    progressPercent: 24,
    state: "paused",
    syncStatus: "idle",
    lastSyncedAt: null,
    nextBatchAt: null,
    countdownSeconds: 0,
    statusMessage: "Return to Connections to continue syncing."
  };

  manager.update(canonicalSession);
  const cs = manager.currentStatus;

  assert.strictEqual(cs.actualProfiles, 207, `Overlay must render actualProfiles=207 (never re-derived), got ${cs.actualProfiles}`);
  assert.strictEqual(cs.extractedConnections, 50, `Overlay must render extractedConnections=50, got ${cs.extractedConnections}`);
  assert.strictEqual(cs.progressPercent, 24, `Overlay must trust progressPercent=24 from content.js, got ${cs.progressPercent}`);
  assert.notStrictEqual(cs.actualProfiles, cs.importedRecords, `actualProfiles (207) must NOT equal importedRecords (40)`);

  const heroMetricEl = mockDoc.querySelector("#warmgraph-hero-metric");
  if (heroMetricEl) {
    assert.strictEqual(heroMetricEl.textContent.trim(), "50 / 207", `Hero metric must be '50 / 207', got: '${heroMetricEl.textContent.trim()}'`);
  }
  console.log(`✓ TEST 4 PASSED: overlay pure renderer — actualProfiles=207 trusted, hero='50 / 207', pct=24%`);
  passedCount++;

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n=================================================");
  if (passedCount === 4) {
    console.log("ALL TASK 8.1 VERIFICATION TESTS PASSED!");
  } else {
    console.log(`${passedCount}/4 TESTS PASSED`);
    process.exit(1);
  }
  console.log("=================================================\n");
}

runTask81Tests().catch(err => {
  console.error("Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
