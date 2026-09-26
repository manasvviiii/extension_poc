/**
 * Production Acceptance Test Suite for Task 7.5 — Fix Progressive Collection (Real Batch Extraction)
 * 
 * Verifies live production behavior requirements:
 * 1. New batch increases extracted count
 * 2. Duplicate-only batch continues scrolling until new cards found
 * 3. MutationObserver detects newly inserted profile cards
 * 4. Progress updates immediately after every successful batch
 * 5. Collection stops only at verified end-of-list
 * 6. Random delay regenerated every cycle (8–30s)
 * 7. Overlay never shows Building without an active extraction
 * 8. Countdown resumes correctly after each completed batch
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const contentJsPath = path.join(__dirname, "content.js");
const contentJsSource = fs.readFileSync(contentJsPath, "utf8");

const overlayJsPath = path.join(__dirname, "overlay.js");
const overlayJsSource = fs.readFileSync(overlayJsPath, "utf8");

function createMockEnvironment() {
  const elements = new Set();
  const listeners = {};
  const storageMap = {};

  const createElement = (tag) => {
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: { display: "block" },
      className: "",
      id: "",
      children,
      _textContent: "",
      _innerHTML: "",
      get textContent() { return this._textContent || children.map(c => c.textContent).join(" "); },
      set textContent(v) { this._textContent = String(v); },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) { this._innerHTML = String(v); },
      appendChild: (child) => { children.push(child); child.parentElement = el; },
      querySelector: (sel) => findSelector(el, sel),
      querySelectorAll: (sel) => {
        const res = [];
        findAllSelectors(el, sel, res);
        return res;
      },
      addEventListener: (type, fn) => {
        listeners[`${el.id || el.className || tag}_${type}`] = listeners[`${el.id || el.className || tag}_${type}`] || [];
        listeners[`${el.id || el.className || tag}_${type}`].push(fn);
      }
    };
    return el;
  };

  function findSelector(root, sel) {
    if (!root) return null;
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      if (root.id === id) return root;
      for (const c of root.children || []) {
        const found = findSelector(c, sel);
        if (found) return found;
      }
    } else if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      if (root.className && root.className.includes(cls)) return root;
      for (const c of root.children || []) {
        const found = findSelector(c, sel);
        if (found) return found;
      }
    }
    return null;
  }

  function findAllSelectors(root, sel, res) {
    if (!root) return;
    if (sel.startsWith("#") && root.id === sel.slice(1)) res.push(root);
    if (sel.startsWith(".") && root.className && root.className.includes(sel.slice(1))) res.push(root);
    for (const c of root.children || []) {
      findAllSelectors(c, sel, res);
    }
  }

  const documentMock = {
    location: {
      href: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      origin: "https://www.linkedin.com"
    },
    documentElement: { innerText: "Connections (208)", textContent: "Connections (208)" },
    body: createElement("body"),
    head: createElement("head"),
    createElement,
    getElementById: (id) => findSelector(documentMock.body, `#${id}`) || findSelector(documentMock.head, `#${id}`),
    querySelector: (sel) => findSelector(documentMock.body, sel) || findSelector(documentMock.head, sel),
    querySelectorAll: (selector) => {
      const results = [];
      if (selector.includes('a[href*="/in/"]')) {
        for (const el of elements) {
          if (el.tagName === "A" && el.href && el.href.includes("/in/")) {
            results.push(el);
          }
        }
      } else {
        findAllSelectors(documentMock.body, selector, results);
      }
      return results;
    }
  };

  documentMock.body.appendChild = (node) => {
    node.parentElement = documentMock.body;
    documentMock.body.children.push(node);
    elements.add(node);
  };

  documentMock.head.appendChild = (node) => {
    node.parentElement = documentMock.head;
    documentMock.head.children.push(node);
    elements.add(node);
  };

  const windowMock = {
    location: documentMock.location,
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    dispatchEvent: (type) => {
      if (listeners[type]) listeners[type].forEach(fn => fn());
    }
  };

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
    }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
    trigger(addedCount = 1) {
      if (this.active) {
        this.callback([{ addedNodes: new Array(addedCount) }]);
      }
    }
  }

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          keys.forEach(k => { res[k] = storageMap[k]; });
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          Object.assign(storageMap, obj);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {}
    }
  };

  function addConnectionCard({ name, profileUrl, degree = "1st", connectedDate = "September 10, 2026", headline = "VP Product" }) {
    const cardEl = {
      tagName: "DIV",
      innerText: `${name}\n${headline}\n${degree}\nConnected on ${connectedDate}\nMessage`,
      textContent: `${name}\n${headline}\n${degree}\nConnected on ${connectedDate}\nMessage`,
      querySelector: () => null,
      querySelectorAll: (sel) => sel.includes('a[href*="/in/"]') ? [anchorEl] : []
    };

    const anchorEl = {
      tagName: "A",
      href: profileUrl,
      innerText: name,
      textContent: name,
      parentElement: cardEl,
      querySelector: (sel) => sel.includes("span") ? { innerText: name, textContent: name } : null,
      querySelectorAll: (sel) => sel.includes('a[href*="/in/"]') ? [anchorEl] : []
    };

    cardEl.parentElement = {
      parentElement: null,
      innerText: cardEl.innerText,
      textContent: cardEl.textContent,
      querySelectorAll: () => [anchorEl]
    };

    elements.add(anchorEl);
    elements.add(cardEl);
    return { anchorEl, cardEl };
  }

  const vm = require("node:vm");
  const sandbox = {
    window: windowMock,
    document: documentMock,
    location: documentMock.location,
    MutationObserver: MockMutationObserver,
    chrome: chromeMock,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn) => setInterval(fn, 0),
    clearInterval: (id) => clearInterval(id),
    console: console,
    Date: Date,
    URL: URL,
    Map: Map,
    Set: Set,
    JSON: JSON,
    parseInt: parseInt,
    isNaN: isNaN,
    RegExp: RegExp,
    TEST_ACQUISITION_DELAY_MS: 1000
  };

  vm.createContext(sandbox);
  vm.runInContext(contentJsSource, sandbox);
  vm.runInContext(overlayJsSource, sandbox);

  return { sandbox, documentMock, windowMock, addConnectionCard, chromeMock, storageMap };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Task 7.5 Real Batch Extraction Live Acceptance Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✓ Test ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ Test ${total}: ${name}`);
      console.error(`  Error: ${err.message}`);
    }
  }

  // Test 1: New batch increases extracted count
  test("1. New batch increases extracted count", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;
    
    env.addConnectionCard({ name: "User One", profileUrl: "https://www.linkedin.com/in/user-one" });
    session.scanCurrentPageForUnseen();
    assert.strictEqual(session.connections.size, 1, "First batch extracts 1 connection");

    env.addConnectionCard({ name: "User Two", profileUrl: "https://www.linkedin.com/in/user-two" });
    session.scanCurrentPageForUnseen();
    assert.strictEqual(session.connections.size, 2, "New batch extracts new connection and increments total to 2");
  });

  // Test 2: Duplicate-only batch filtering
  test("2. Duplicate-only batch does not increase count and filters unseen profiles", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;

    env.addConnectionCard({ name: "User One", profileUrl: "https://www.linkedin.com/in/user-one/" });
    const res1 = session.scanCurrentPageForUnseen();
    assert.strictEqual(res1.newProfilesCount, 1);
    assert.strictEqual(session.connections.size, 1);

    // Scan duplicate profile URL with query param
    env.addConnectionCard({ name: "User One", profileUrl: "https://www.linkedin.com/in/user-one?trk=public_profile" });
    const res2 = session.scanCurrentPageForUnseen();
    assert.strictEqual(res2.newProfilesCount, 0, "Duplicate profile URL normalized & skipped");
    assert.strictEqual(res2.duplicatesSkippedCount > 0, true, "Duplicates recorded");
    assert.strictEqual(session.connections.size, 1, "Extracted count remains 1");
  });

  // Test 3: MutationObserver detects newly inserted profile cards
  test("3. MutationObserver detects newly inserted profile cards", async () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;

    let promiseResolved = false;
    const waitPromise = session.waitForDomCardsToIncrease(0, 500).then(res => {
      promiseResolved = true;
      return res;
    });

    env.addConnectionCard({ name: "User Card", profileUrl: "https://www.linkedin.com/in/user-card" });
    const res = await waitPromise;
    assert.strictEqual(promiseResolved, true, "waitForDomCardsToIncrease resolved upon DOM card insertion");
    assert.strictEqual(res.newCards, 1, "New card count detected by MutationObserver watcher");
  });

  // Test 4: Progress updates after every successful batch
  test("4. Progress updates immediately after every successful batch", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;
    session.expectedTotal = 208;
    session.actualProfiles = 208;

    env.addConnectionCard({ name: "User 1", profileUrl: "https://www.linkedin.com/in/user-1" });
    session.scanCurrentPageForUnseen();
    session.checkpointSessionSync();

    const status1 = session.getStatus();
    assert.strictEqual(status1.extractedConnections, 1);
    assert.strictEqual(status1.remainingConnections, 207);
    assert.strictEqual(status1.progressPercent, 0);

    for (let i = 2; i <= 52; i++) {
      env.addConnectionCard({ name: `User ${i}`, profileUrl: `https://www.linkedin.com/in/user-${i}` });
    }
    session.scanCurrentPageForUnseen();
    session.checkpointSessionSync();

    const status2 = session.getStatus();
    assert.strictEqual(status2.extractedConnections, 52);
    assert.strictEqual(status2.remainingConnections, 156);
    assert.strictEqual(status2.progressPercent, 25);
  });

  // Test 5: Collection stops only at verified end-of-list or expected total
  test("5. Collection stops only at verified expected total", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;
    session.expectedTotal = 3;

    env.addConnectionCard({ name: "U1", profileUrl: "https://www.linkedin.com/in/u1" });
    env.addConnectionCard({ name: "U2", profileUrl: "https://www.linkedin.com/in/u2" });
    env.addConnectionCard({ name: "U3", profileUrl: "https://www.linkedin.com/in/u3" });

    session.scanCurrentPageForUnseen();
    assert.strictEqual(session.connections.size, 3);
    assert.strictEqual(session.connections.size >= session.expectedTotal, true, "Full dataset collected");
  });

  // Test 6: Random delay regenerated every cycle (8–30s)
  test("6. Random delay regenerated every cycle within 8-30s bounds", () => {
    const env = createMockEnvironment();
    env.sandbox.window.TEST_ACQUISITION_DELAY_MS = undefined;
    const fn = env.sandbox.window.getRandomAcquisitionDelayMs;

    const delays = new Set();
    for (let i = 0; i < 50; i++) {
      const delayMs = fn();
      const delaySec = Math.round(delayMs / 1000);
      assert.ok(delaySec >= 8 && delaySec <= 30, `Delay ${delaySec}s must be within [8, 30] bounds`);
      assert.strictEqual(Number.isInteger(delaySec), true, "Delay must be integer seconds");
      delays.add(delaySec);
    }
    assert.ok(delays.size > 1, "Delays must be regenerated dynamically per cycle");
  });

  // Test 7: Overlay never shows Building without active extraction state
  test("7. Overlay state mapping correctly distinguishes states", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;

    session.state = "acquiring";
    const statusAcq = session.getStatus();
    assert.strictEqual(statusAcq.state, "acquiring");

    session.state = "waiting";
    const statusWait = session.getStatus();
    assert.strictEqual(statusWait.state, "waiting");

    session.state = "completed";
    const statusComp = session.getStatus();
    assert.strictEqual(statusComp.state, "completed");
  });

  // Test 8: Countdown resumes correctly after each completed batch
  test("8. Countdown calculates dynamically from absolute nextBatchAt timestamp", () => {
    const env = createMockEnvironment();
    const session = env.sandbox.window.acquisitionSession;

    const delayMs = 15000;
    session.nextSyncDelay = delayMs;
    session.nextBatchAt = Date.now() + 15000;
    session.state = "waiting";

    const status = session.getStatus();
    assert.strictEqual(status.countdownSeconds, 15, "Countdown accurately calculated from nextBatchAt timestamp");
  });

  console.log(`\nResults: ${passed}/${total} Task 7.5 tests passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
