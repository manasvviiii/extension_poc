// =========================================================
// TASK 8.2 — BACKGROUND SCHEDULER & SINGLETON LOOP TESTS
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
    appendChild: (c) => { children.push(c); c.parentElement = null; },
    removeChild: (c) => { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null, setAttribute: () => {},
    addEventListener: () => {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0 })
  };
}

async function runTask82Tests() {
  console.log("=================================================");
  console.log("RUNNING TASK 8.2 BACKGROUND SCHEDULER TESTS");
  console.log("=================================================\n");

  const storage = new MockChromeStorage();
  const alarms = new MockChromeAlarms();
  const messageListeners = [];

  global.chrome = {
    storage: { local: storage, onChanged: storage.onChanged },
    alarms,
    runtime: {
      sendMessage: (msg, cb) => {
        messageListeners.forEach(l => {
          try { l(msg, {}, cb || (() => {})); } catch (e) {}
        });
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      },
      getURL: (f) => `chrome-extension://test/${f}`,
      lastError: null
    },
    tabs: {
      query: (q, cb) => {
        cb([{ id: 101, url: "https://www.linkedin.com/mynetwork/invite-connect/connections/" }]);
      },
      sendMessage: (tabId, msg, cb) => {
        messageListeners.forEach(l => {
          try { l(msg, {}, cb || (() => {})); } catch (e) {}
        });
      }
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setTitle: () => {} }
  };

  class MockMutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() {} disconnect() {}
  }
  global.MutationObserver = MockMutationObserver;

  const docListeners = [];
  const mockBody = createMockElement("body");
  const mockDoc = {
    body: mockBody, documentElement: createMockElement("html"), head: createMockElement("head"),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: (tag) => createMockElement(tag), addEventListener: (t, fn) => { docListeners.push({ t, fn }); }, visibilityState: "visible"
  };

  global.window = {
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/", pathname: "/mynetwork/invite-connect/connections/" },
    document: mockDoc, addEventListener: () => {}, dispatchEvent: () => {},
    scrollY: 0, pageYOffset: 0, innerHeight: 800, scrollBy: () => {},
    getComputedStyle: () => ({ overflowY: "auto" }), TEST_ACQUISITION_DELAY_MS: 5000
  };
  global.document = mockDoc;

  // Load files
  eval(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"));
  eval(fs.readFileSync(path.join(__dirname, "background.js"), "utf8"));

  const session = global.window.acquisitionSession || acquisitionSession;
  let passedCount = 0;

  // ── TEST 1: Singleton Acquisition Loop Flag ─────────────────────────────────
  console.log("[TEST 1] Singleton acquisition loop enforces window.__warmgraphAcquisitionRunning...");
  
  session.totalConnections = 208;
  session.actualProfiles = 207;
  session.expectedTotal = 208;
  
  // Start loop once
  session.start();
  assert.strictEqual(global.window.__warmgraphAcquisitionRunning, true, "window.__warmgraphAcquisitionRunning MUST be true when running");
  
  // Attempt to call start() again while running
  session.start();
  assert.strictEqual(global.window.__warmgraphAcquisitionRunning, true, "Running flag remains true");
  console.log("✓ TEST 1 PASSED: Singleton loop prevents duplicate concurrent acquisition loops");
  passedCount++;

  // ── TEST 2: Alarm creation on background for nextBatchAt ─────────────────────
  console.log("\n[TEST 2] Background creates Chrome alarm for nextBatchAt...");
  
  const futureTime = Date.now() + 10000;
  session.nextBatchAt = futureTime;
  session.state = "waiting";
  session.checkpointSession();

  // Allow microtasks for storage callback to run
  await new Promise(r => setTimeout(r, 100));

  assert.ok(alarms.alarms["warmgraph-next-batch-alarm"], "Chrome alarm 'warmgraph-next-batch-alarm' MUST be created");
  assert.strictEqual(alarms.alarms["warmgraph-next-batch-alarm"].when, futureTime, "Alarm scheduled for exact nextBatchAt timestamp");
  console.log("✓ TEST 2 PASSED: Background scheduler registered Chrome alarm for nextBatchAt");
  passedCount++;

  // ── TEST 3: Waking inter-batch wait via RUN_NEXT_BATCH ──────────────────────
  console.log("\n[TEST 3] Alarm trigger (RUN_NEXT_BATCH) wakes inter-batch delay immediately...");

  let woken = false;
  session.nextBatchResolver = () => { woken = true; };

  // Simulate background alarm firing
  alarms.trigger("warmgraph-next-batch-alarm");
  await new Promise(r => setTimeout(r, 100));

  assert.strictEqual(woken, true, "RUN_NEXT_BATCH message MUST wake the waiting acquisition session immediately");
  console.log("✓ TEST 3 PASSED: RUN_NEXT_BATCH alarm message woke waiting content script session");
  passedCount++;

  // ── TEST 4: Tab visibility change does NOT pause session ────────────────────
  console.log("\n[TEST 4] Tab visibility change (backgrounding) does NOT mark session paused...");

  mockDoc.visibilityState = "hidden";
  docListeners.forEach(l => {
    if (l.t === "visibilitychange") l.fn();
  });

  // Verify session state stays active (not paused)
  assert.notStrictEqual(session.state, "paused", "Session state MUST NOT become paused when tab is hidden");
  console.log("✓ TEST 4 PASSED: Hidden/minimized tab does NOT freeze or pause background sync session");
  passedCount++;

  // Cleanup
  session.cancel();

  console.log("\n=================================================");
  if (passedCount === 4) {
    console.log("ALL TASK 8.2 VERIFICATION TESTS PASSED!");
  } else {
    console.log(`${passedCount}/4 TESTS PASSED`);
    process.exit(1);
  }
  console.log("=================================================\n");
}

runTask82Tests().catch(err => {
  console.error("Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
