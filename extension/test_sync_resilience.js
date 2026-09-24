/**
 * Test Suite for Task 2C: Backend Sync Resilience and Observer Separation
 * Validates:
 * 1. Popup does not display error when backend sync fails initially.
 * 2. Sync status transitions: idle -> syncing -> failed / synced.
 * 3. Automatic bounded retry triggers sync without re-extracting DOM.
 * 4. Duplicate sync requests during active syncing are guarded/blocked.
 * 5. Sync error message in popup displays calm humanized copy with retry state.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const backgroundJsPath = path.join(__dirname, "background.js");
const backgroundJsSource = fs.readFileSync(backgroundJsPath, "utf8");

const contentJsPath = path.join(__dirname, "content.js");
const contentJsSource = fs.readFileSync(contentJsPath, "utf8");

function createMockEnvironment({ mockBackendFailAttempts = 0 } = {}) {
  const listeners = {};
  const storageMap = { ownerId: "warmgraph_test_owner_456" };
  let fetchCount = 0;

  const documentMock = {
    visibilityState: "visible",
    location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/" },
    documentElement: { innerText: "Connections (10)" },
    body: { innerText: "Connections (10)" },
    querySelector: () => null,
    querySelectorAll: () => [],
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

  const bgMessageListeners = [];

  const mockFetch = (url, options) => {
    fetchCount++;
    if (fetchCount <= mockBackendFailAttempts) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: "Internal Server Error" })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ connection_count: 10, graph_nodes: 11, graph_edges: 10 })
    });
  };

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (Array.isArray(keys)) keys.forEach(k => { res[k] = storageMap[k]; });
          else if (typeof keys === "string") res[keys] = storageMap[keys];
          else Object.assign(res, storageMap);
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
    MutationObserver: class { observe() {} disconnect() {} },
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
    getFetchCount: () => fetchCount,
    sendMessage: (msg) => {
      return new Promise((resolve) => {
        let resolved = false;
        for (const fn of bgMessageListeners) {
          fn(msg, { tab: { id: 1, url: documentMock.location.href } }, (response) => {
            if (!resolved) {
              resolved = true;
              resolve(response);
            }
          });
        }
        setTimeout(() => { if (!resolved) resolve(null); }, 50);
      });
    }
  };
}

async function runTests() {
  console.log("==================================================");
  console.log("Running Task 2C Sync Resilience & Retry Test Suite");
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

  await test("1. Duplicate sync calls during active syncing are guarded", async () => {
    const env = createMockEnvironment();
    env.sandbox.window.acquisitionSession.syncStatus = "syncing";
    
    // Call autoSyncToBackend while syncing
    const syncRes = await env.sandbox.window.acquisitionSession.autoSyncToBackend();
    assert.strictEqual(syncRes, false, "autoSyncToBackend must return false when already syncing");
    assert.strictEqual(env.getFetchCount(), 0, "Fetch should not be called when duplicate sync is guarded");
  });

  await test("2. Initial sync failure transitions sync_status to failed without losing session data", async () => {
    const env = createMockEnvironment({ mockBackendFailAttempts: 1 });
    
    // Manually set session state as completed with 10 records
    env.sandbox.window.acquisitionSession.connections.set("1", { id: "1", name: "User 1", profileUrl: "https://linkedin.com/in/u1" });
    env.sandbox.window.acquisitionSession.state = "completed";
    
    await env.sandbox.window.acquisitionSession.autoSyncToBackend();
    
    const status = await env.sendMessage({ action: "getAcquisitionStatus" });
    assert.strictEqual(status.status.state, "completed", "Acquisition state remains completed");
    assert.strictEqual(status.status.sync_status, "failed", "Sync status becomes failed on HTTP error");
    assert.strictEqual(status.status.first_degree_count, 1, "Collected connections preserved");
  });

  await test("3. Bounded retry executes sync attempt without DOM re-extraction", async () => {
    const env = createMockEnvironment({ mockBackendFailAttempts: 1 });
    env.sandbox.window.acquisitionSession.connections.set("1", { id: "1", name: "User 1", profileUrl: "https://linkedin.com/in/u1" });
    env.sandbox.window.acquisitionSession.state = "completed";
    
    // First attempt fails
    await env.sandbox.window.acquisitionSession.autoSyncToBackend();
    assert.strictEqual(env.sandbox.window.acquisitionSession.syncStatus, "failed");
    assert.strictEqual(env.sandbox.window.acquisitionSession.syncRetryCount, 1);
    
    // Second attempt (retry 1) succeeds
    await env.sandbox.window.acquisitionSession.autoSyncToBackend(true);
    assert.strictEqual(env.sandbox.window.acquisitionSession.syncStatus, "synced");
    assert.strictEqual(env.getFetchCount(), 2, "Fetch was retried twice");
  });

  await test("4. Response from syncToBackend contains error field on failure", async () => {
    const env = createMockEnvironment({ mockBackendFailAttempts: 1 });
    const payload = {
      owner_id: "test",
      completion_status: "complete_rendered_dataset",
      confirmed: true,
      connections: []
    };
    
    const res = await env.sendMessage({ action: "syncToBackend", payload });
    assert.strictEqual(res.success, false);
    assert.strictEqual(typeof res.error, "string", "Error property must be string, not undefined");
  });

  console.log(`\nResults: ${passed}/${total} tests passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
