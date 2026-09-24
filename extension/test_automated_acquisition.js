/**
 * Test Suite for Zero-Click Fully Automatic Connection Acquisition
 * Validates automatic page detection, zero user click requirement, pagination processing,
 * deterministic deduplication across 1,000+ records, auto-sync guard state machine,
 * dynamic owner identity, and PERSISTENT ACQUISITION SESSIONS.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Read source files
const backgroundJsPath = path.join(__dirname, "background.js");
const backgroundJsSource = fs.readFileSync(backgroundJsPath, "utf8");

const contentJsPath = path.join(__dirname, "content.js");
const contentJsSource = fs.readFileSync(contentJsPath, "utf8");

function createMockPaginatedEnvironment({ totalRecords = 1020, pageSize = 50, includeDuplicates = true, singlePageOnly = false, mockBackendSuccess = true, existingStorageMap = null } = {}) {
  const elements = new Set();
  const listeners = {};
  
  let currentPage = 1;
  const totalPages = singlePageOnly ? 1 : Math.ceil(totalRecords / pageSize);

  const allRecords = [];
  for (let i = 1; i <= totalRecords; i++) {
    const isDuplicate = includeDuplicates && (i % 73 === 0);
    const personId = isDuplicate ? (i - 10) : i;
    const name = `Synthetic Person #${personId}`;
    const profileUrl = `https://www.linkedin.com/in/synthetic-person-${personId}`;
    allRecords.push({ id: personId, name, profileUrl, headline: `Engineer #${personId}` });
  }

  let nextBtnEl = null;

  function renderDOMPage(page) {
    elements.clear();
    currentPage = page;

    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, totalRecords);
    const pageRecords = allRecords.slice(start, end);

    pageRecords.forEach(rec => {
      const anchorEl = {
        tagName: "A",
        href: rec.profileUrl,
        innerText: rec.name,
        textContent: rec.name,
        scrollIntoView: () => { if (nextBtnEl) nextBtnEl.click(); },
        querySelector: (sel) => sel.includes("span") ? { innerText: rec.name, textContent: rec.name } : null
      };

      const cardEl = {
        tagName: "DIV",
        innerText: `${rec.name}\n${rec.headline}\n1st\nConnected on Sep 10, 2026\nMessage`,
        textContent: `${rec.name}\n${rec.headline}\n1st\nConnected on Sep 10, 2026\nMessage`,
        scrollIntoView: () => { if (nextBtnEl) nextBtnEl.click(); },
        querySelector: () => null,
        querySelectorAll: (sel) => sel.includes('a[href*="/in/"]') ? [anchorEl] : []
      };

      anchorEl.parentElement = cardEl;
      cardEl.parentElement = { querySelectorAll: () => [anchorEl] };

      elements.add(anchorEl);
      elements.add(cardEl);
    });

    if (!singlePageOnly && currentPage < totalPages) {
      nextBtnEl = {
        id: "nextPage",
        tagName: "BUTTON",
        innerText: "Next Page",
        textContent: "Next Page",
        disabled: false,
        classList: { contains: () => false },
        getAttribute: (attr) => attr === "aria-label" ? "Next Page" : null,
        click: () => {
          if (currentPage < totalPages) {
            renderDOMPage(currentPage + 1);
          }
        }
      };
      elements.add(nextBtnEl);
    } else {
      nextBtnEl = null;
    }
  }

  renderDOMPage(1);

  const documentMock = {
    visibilityState: "visible",
    location: {
      href: "https://www.linkedin.com/mynetwork/invite-connect/connections/",
      origin: "https://www.linkedin.com"
    },
    documentElement: { innerText: `Connections (${totalRecords})`, textContent: `Connections (${totalRecords})` },
    body: { innerText: `Connections (${totalRecords})`, textContent: `Connections (${totalRecords})` },
    querySelector: (selector) => {
      if (selector.includes("nextPage") || selector.includes("next")) {
        return nextBtnEl;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const results = [];
      for (const el of elements) {
        if (selector.includes('a[href*="/in/"]') && el.tagName === "A" && el.href && el.href.includes("/in/")) {
          results.push(el);
        } else if ((selector.includes("button") || selector.includes("a")) && el.tagName === "BUTTON") {
          results.push(el);
        }
      }
      return results;
    },
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }
  };

  const windowMock = {
    TEST_ACQUISITION_DELAY_MS: 10,
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
    constructor() {}
    observe() {}
    disconnect() {}
  }

  const bgMessageListeners = [];
  const storageMap = Object.assign({ ownerId: "warmgraph_test_owner_123" }, existingStorageMap || {});
  let backendFetchCallCount = 0;
  let backendPayload = null;

  const mockFetch = (url, options) => {
    backendFetchCallCount++;
    if (options && options.body) {
      backendPayload = JSON.parse(options.body);
    }
    if (mockBackendSuccess) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ connection_count: 100, relationship_evidence_count: 0, graph_nodes: 101, graph_edges: 100 })
      });
    } else {
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ detail: "Mock server error" })
      });
    }
  };

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) {
            keys.forEach(k => { res[k] = storageMap[k]; });
          } else if (typeof keys === "string") {
            res[keys] = storageMap[keys];
          } else if (keys === null || keys === undefined) {
            Object.assign(res, storageMap);
          } else if (typeof keys === "object") {
            Object.keys(keys).forEach(k => { res[k] = storageMap[k] !== undefined ? storageMap[k] : keys[k]; });
          }
          if (cb) cb(res);
        },
        set: (obj, cb) => {
          Object.assign(storageMap, obj);
          if (cb) cb();
        }
      }
    },
    runtime: {
      onMessage: {
        addListener: (fn) => { bgMessageListeners.push(fn); }
      },
      sendMessage: (msg, cb) => {
        let handled = false;
        let responseSent = false;
        for (const fn of bgMessageListeners) {
          const isAsync = fn(msg, { tab: { id: 1, url: documentMock.location.href } }, (res) => {
            responseSent = true;
            if (cb) cb(res);
          });
          if (isAsync || responseSent) handled = true;
        }
        if (!handled && !responseSent && cb) cb(null);
      }
    }
  };

  const vm = require("node:vm");
  const sandbox = {
    window: windowMock,
    document: documentMock,
    location: documentMock.location,
    MutationObserver: MockMutationObserver,
    chrome: chromeMock,
    fetch: mockFetch,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    console: console,
    Date: Date,
    URL: URL,
    Map: Map,
    Set: Set,
    JSON: JSON,
    parseInt: parseInt,
    isNaN: isNaN,
    RegExp: RegExp,
    Promise: Promise
  };

  vm.createContext(sandbox);
  vm.runInContext(backgroundJsSource, sandbox);
  vm.runInContext(contentJsSource, sandbox);

  return {
    sandbox,
    storageMap,
    bgMessageListeners,
    documentMock,
    windowMock,
    resetDOMPage: () => renderDOMPage(1),
    getBackendFetchCallCount: () => backendFetchCallCount,
    getBackendPayload: () => backendPayload,
    sendMessage: (msg, senderTabId = 1) => {
      return new Promise((resolve) => {
        let resolved = false;
        for (const fn of bgMessageListeners) {
          const res = fn(msg, { tab: { id: senderTabId, url: documentMock.location.href } }, (response) => {
            if (!resolved) {
              resolved = true;
              resolve(response);
            }
          });
        }
        setTimeout(() => {
          if (!resolved) resolve(null);
        }, 50);
      });
    }
  };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Zero-Click Automated Acquisition Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✓ Test ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ Test ${total}: ${name}`);
      console.error(`  Error: ${err.message}`);
    }
  }

  // Test 1: Page detection automatically starts acquisition without user click
  await test("1. Connections page detection automatically starts acquisition", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50 });
    await new Promise(r => setTimeout(r, 150));

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    const activeStates = ["acquiring", "waiting_for_content", "settling", "completed"];
    assert.ok(activeStates.includes(status.status.state), `State must be active acquisition state, got: ${status.status.state}`);
  });

  // Test 2: No user click required for full flow
  await test("2. No user click required for complete flow", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
  });

  // Test 3: Multiple acquisition batches are processed automatically
  await test("3. Multiple acquisition batches are processed automatically", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 150, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.page_count, 3);
  });

  // Test 4: Records are deduplicated across batches
  await test("4. Records are deduplicated across paginated batches", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 200, pageSize: 50, includeDuplicates: true });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.ok(status.status.first_degree_count < 200, "Duplicates should be removed");
  });

  // Test 5: Acquisition does not stop at initial 40 records when more pages exist
  await test("5. Acquisition does not stop at initial ~40 records", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 1020, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.page_count, 21);
    assert.ok(status.status.first_degree_count > 900, "All 1,020 records acquired");
  });

  // Test 6: Completion is only reported when full available dataset is acquired
  await test("6. Completion is only reported when full dataset is acquired", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
    assert.strictEqual(status.status.is_partial, false);
  });

  // Test 7: Automatic backend sync occurs AFTER verified complete acquisition
  await test("7. Automatic backend sync occurs AFTER verified complete acquisition", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
    assert.strictEqual(status.status.sync_status, "synced");
    assert.strictEqual(env.getBackendFetchCallCount(), 1, "Backend sync fetch must be called automatically on completion");
  });

  // Test 8: Automatic backend sync is BLOCKED when acquisition is incomplete/partial
  await test("8. Automatic backend sync is strictly BLOCKED on incomplete/partial dataset", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 206, pageSize: 40, singlePageOnly: true });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "incomplete");
    assert.strictEqual(status.status.is_partial, true);
    assert.strictEqual(status.status.sync_status, "blocked");
    assert.strictEqual(env.getBackendFetchCallCount(), 0, "Backend sync MUST NOT be called for partial dataset");
  });

  // Test 9: Dynamic owner identity is preserved
  await test("9. Dynamic owner identity is sent with auto-sync payload", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const payload = env.getBackendPayload();
    assert.ok(payload);
    assert.strictEqual(payload.owner_id, "warmgraph_test_owner_123");
  });

  // Test 10: Duplicate acquisition sessions do not create duplicate records
  await test("10. Duplicate acquisition sessions do not duplicate records", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    env.resetDOMPage();
    await env.sendMessage({ action: "startAutomatedAcquisition" });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.first_degree_count, 100, "Record count remains exactly 100 after re-acquisition");
  });

  // =========================================================
  // NEW PERSISTENT ACQUISITION SESSION TESTS (11 - 20)
  // =========================================================

  // Test 11: Start session -> persistent state exists in chrome.storage.local
  await test("11. Start session creates persistent state in chrome.storage.local", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));

    const sessionInStorage = env.storageMap.acquisition_session;
    assert.ok(sessionInStorage, "acquisition_session must exist in storageMap");
    assert.ok(sessionInStorage.sessionId, "Session must have a unique sessionId");
    assert.ok(sessionInStorage.collectedCount > 0, "Storage must contain collected connections");
  });

  // Test 12: Popup closure -> session remains in background storage
  await test("12. Popup closure leaves background session intact", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));

    // Simulate closing popup (no popup message calls) while session completes
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const sessionInStorage = env.storageMap.acquisition_session;
    assert.ok(sessionInStorage, "Session checkpoint must remain in storage after popup closure");
    assert.strictEqual(sessionInStorage.state, "completed");
  });

  // Test 13: Popup reopens -> same session is displayed
  await test("13. Popup reopens and displays existing background session state", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    // Simulate popup reopening by sending GET_SESSION_STATUS to background
    const bgStatus = await env.sendMessage({ action: "GET_SESSION_STATUS" });
    assert.ok(bgStatus && bgStatus.success);
    assert.strictEqual(bgStatus.status.sessionId, env.storageMap.acquisition_session.sessionId);
    assert.strictEqual(bgStatus.status.collectedCount, env.storageMap.acquisition_session.collectedCount);
  });

  // Test 14: Tab becomes hidden -> session does not become incomplete due to background throttling
  await test("14. Tab hidden visibilityState does not mark session as incomplete", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 200, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 50));

    // Simulate user switching tabs (document.visibilityState = "hidden")
    env.sandbox.document.visibilityState = "hidden";
    env.sandbox.window.dispatchEvent("visibilitychange");

    await new Promise(r => setTimeout(r, 150));

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.notStrictEqual(status.status.state, "incomplete", "Session must NOT be aborted as incomplete on hidden tab");
  });

  // Test 15: Tab becomes visible -> same session resumes
  await test("15. Tab returning to visible resumes active session", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    env.sandbox.document.visibilityState = "hidden";
    env.sandbox.window.dispatchEvent("visibilitychange");
    await new Promise(r => setTimeout(r, 100));

    env.sandbox.document.visibilityState = "visible";
    env.sandbox.window.dispatchEvent("visibilitychange");
    await new Promise(r => setTimeout(r, 150));

    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
  });

  // Test 16: Page unload -> checkpoint is preserved instead of canceling/wiping
  await test("16. Page unload preserves checkpoint in storage instead of wiping data", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 100));

    // Trigger beforeunload event
    env.windowMock.dispatchEvent("beforeunload");

    const sessionInStorage = env.storageMap.acquisition_session;
    assert.ok(sessionInStorage, "Session in storage must exist after beforeunload");
    assert.strictEqual(sessionInStorage.state, "interrupted");
    assert.ok(sessionInStorage.collectedCount > 0, "Collected connections must NOT be wiped on unload");
  });

  // Test 17: Content script reload -> existing session is restored
  await test("17. Content script re-injection restores existing persistent session", async () => {
    const env1 = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 100));
    env1.windowMock.dispatchEvent("beforeunload");

    const savedStorageMap = env1.storageMap;

    const env2 = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false, existingStorageMap: savedStorageMap });
    await env2.sandbox.window.acquisitionSession.initOrHydrateSession();

    const restoredStatus = await env2.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(restoredStatus.status.sessionId, savedStorageMap.acquisition_session.sessionId, "Session ID must be restored");
    assert.strictEqual(restoredStatus.status.first_degree_count, savedStorageMap.acquisition_session.collectedCount, "Collected count must be restored");
  });

  // Test 18: Existing connections are not duplicated after restore
  await test("18. Connections are not duplicated after session restoration", async () => {
    const env1 = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 100));
    env1.windowMock.dispatchEvent("beforeunload");

    const savedStorageMap = env1.storageMap;

    const env2 = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false, existingStorageMap: savedStorageMap });
    await env2.sandbox.window.acquisitionSession.initOrHydrateSession();
    env2.sandbox.window.acquisitionSession.scanCurrentPage();

    const restoredStatus = await env2.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(restoredStatus.status.first_degree_count, 50, "Re-scanning page 1 after restore adds 0 duplicate records");
  });

  // Test 19: Starting acquisition twice on different tabs does not create competing sessions
  await test("19. Duplicate start request on secondary tab recognizes existing active session", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 100));

    const existingSessionId = env.storageMap.acquisition_session.sessionId;

    const secondaryRes = await env.sendMessage({ action: "START_SESSION" }, 99);

    assert.ok(secondaryRes);
    assert.strictEqual(secondaryRes.isExistingSession, true);
    assert.strictEqual(secondaryRes.status.sessionId, existingSessionId, "Secondary tab receives existing active session without starting a second session");
  });

  // Test 20: Completing acquisition persists the completed state
  await test("20. Completing acquisition persists completed state in storage", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const sessionInStorage = env.storageMap.acquisition_session;
    assert.strictEqual(sessionInStorage.state, "completed");
    assert.strictEqual(sessionInStorage.isPartial, false);
    assert.strictEqual(sessionInStorage.collectedCount, 100);
  });

  // Test 21: Full count 206/206 completion terminates loop without cycling
  await test("21. Full count 206/206 completion terminates loop without infinite cycling", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 206, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
    assert.strictEqual(status.status.first_degree_count, 206);
    assert.strictEqual(status.status.is_partial, false);
  });

  // Test 22: Accepted rendered dataset 205/206 terminates loop in completed state
  await test("22. Accepted rendered dataset 205/206 terminates loop in completed state", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 205, pageSize: 50, includeDuplicates: false });
    env.sandbox.document.documentElement.innerText = "Connections (206)";
    env.sandbox.document.body.innerText = "Connections (206)";
    env.sandbox.window.acquisitionSession.expectedTotal = 206;
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
    assert.strictEqual(status.status.completion_status, "complete_rendered_dataset");
    assert.strictEqual(status.status.is_partial, false);
  });

  console.log(`\nResults: ${passed}/${total} tests passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
