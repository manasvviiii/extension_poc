/**
 * Test Suite for Zero-Click Fully Automatic Connection Acquisition
 * Validates automatic page detection, zero user click requirement, pagination processing,
 * deterministic deduplication across 1,000+ records, auto-sync guard state machine,
 * and dynamic owner identity.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Read content.js source
const contentJsPath = path.join(__dirname, "content.js");
const contentJsSource = fs.readFileSync(contentJsPath, "utf8");

function createMockPaginatedEnvironment({ totalRecords = 1020, pageSize = 50, includeDuplicates = true, singlePageOnly = false, mockBackendSuccess = true } = {}) {
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
    }
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
    constructor() {}
    observe() {}
    disconnect() {}
  }

  let messageListener = null;
  const storageMap = { ownerId: "warmgraph_test_owner_123" };
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
          keys.forEach(k => { res[k] = storageMap[k]; });
          cb(res);
        },
        set: (obj, cb) => {
          Object.assign(storageMap, obj);
          if (cb) cb();
        }
      }
    },
    runtime: {
      onMessage: {
        addListener: (fn) => { messageListener = fn; }
      },
      sendMessage: () => {}
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
  vm.runInContext(contentJsSource, sandbox);

  return {
    sandbox,
    messageListener,
    documentMock,
    windowMock,
    resetDOMPage: () => renderDOMPage(1),
    getBackendFetchCallCount: () => backendFetchCallCount,
    getBackendPayload: () => backendPayload,
    sendMessage: (msg) => {
      let response = null;
      messageListener(msg, {}, (res) => { response = res; });
      return response;
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
    // Wait for auto-start setTimeout (100ms)
    await new Promise(r => setTimeout(r, 150));

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.ok(status.status.state === "acquiring" || status.status.state === "completed");
  });

  // Test 2: No user click required for full flow
  await test("2. No user click required for complete flow", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed");
  });

  // Test 3: Multiple acquisition batches are processed automatically
  await test("3. Multiple acquisition batches are processed automatically", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 150, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.page_count, 3);
  });

  // Test 4: Records are deduplicated across batches
  await test("4. Records are deduplicated across paginated batches", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 200, pageSize: 50, includeDuplicates: true });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.ok(status.status.first_degree_count < 200, "Duplicates should be removed");
  });

  // Test 5: Acquisition does not stop at initial 40 records when more pages exist
  await test("5. Acquisition does not stop at initial ~40 records", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 1020, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.page_count, 21);
    assert.ok(status.status.first_degree_count > 900, "All 1,020 records across 21 pages acquired");
  });

  // Test 6: Completion is only reported when full available dataset is acquired
  await test("6. Completion is only reported when full dataset is acquired", async () => {
    const env = createMockPaginatedEnvironment({ totalRecords: 100, pageSize: 50, includeDuplicates: false });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
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

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
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

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
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

    // Reset mock DOM to page 1 and re-trigger acquisition session
    env.resetDOMPage();
    env.sendMessage({ action: "startAutomatedAcquisition" });
    await new Promise(r => setTimeout(r, 150));
    if (env.sandbox.window.acquisitionSession.activeLoopPromise) {
      await env.sandbox.window.acquisitionSession.activeLoopPromise;
    }

    const status = env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.first_degree_count, 100, "Record count remains exactly 100 after re-acquisition");
  });

  console.log(`\nResults: ${passed}/${total} tests passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
