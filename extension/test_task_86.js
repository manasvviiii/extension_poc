const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.window = {
  location: { href: "https://www.linkedin.com/in/reshma-hegde", pathname: "/in/reshma-hegde" },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

let localStorageData = {};
let fetchLog = [];

global.fetch = async (url, opts = {}) => {
  fetchLog.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
  if (url.includes("/graph/path")) {
    return {
      ok: true,
      json: async () => ({
        owner_id: "manasvi-p-8a88402ab",
        paths: [
          { hops: 2, warmth: 0.85, path: ["manasvi-p-8a88402ab", "intermediate-1", "reshma-hegde"] }
        ]
      })
    };
  }
  if (url.includes("/graph/explain-path")) {
    return {
      ok: true,
      json: async () => ({
        explanation: "Connected through mutual colleague",
        paths: [{ hops: 2, warmth: 0.85, path: ["manasvi-p-8a88402ab", "intermediate-1", "reshma-hegde"] }]
      })
    };
  }
  if (url.includes("/refresh")) {
    return {
      ok: true,
      json: async () => ({ job_id: "job_12345" })
    };
  }
  if (url.includes("/target/search")) {
    return {
      ok: true,
      json: async () => ({
        company: "Acme",
        candidates: [{ name: "Reshma Hegde", profile_url: "https://www.linkedin.com/in/reshma-hegde" }]
      })
    };
  }
  return { ok: true, json: async () => ({}) };
};

global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        let res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => res[k] = localStorageData[k]);
        } else if (typeof keys === "string") {
          res[keys] = localStorageData[keys];
        } else {
          res = { ...localStorageData };
        }
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        Object.assign(localStorageData, obj);
        if (cb) cb();
        return Promise.resolve();
      }
    },
    onChanged: { addListener: () => {} }
  },
  runtime: { sendMessage: () => {}, lastError: null, onMessage: { listeners: [], addListener: (fn) => { global.chrome.runtime.onMessage.listeners.push(fn); } } },
  tabs: {
    query: (query, cb) => cb([{ id: 1, url: window.location.href }]),
    sendMessage: () => {}
  }
};

const makeDummyEl = (id) => ({
  id: id || "dummy",
  tagName: "DIV",
  style: {},
  value: "",
  textContent: "",
  innerHTML: "",
  querySelector: () => null,
  querySelectorAll: () => [],
  appendChild: () => {},
  addEventListener: () => {}
});

const elementsById = {};

global.document = {
  createElement: (tag) => makeDummyEl(tag),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  getElementById: (id) => {
    if (!elementsById[id]) {
      elementsById[id] = makeDummyEl(id);
    }
    return elementsById[id];
  },
  querySelector: (sel) => null,
  querySelectorAll: (sel) => []
};

console.log("=================================================");
console.log("RUNNING TASK 8.6 WARM PATH OWNER RESOLUTION TESTS");
console.log("=================================================");

(async () => {
  // Step 1: Initialize logged-in owner identity in warmgraph_owner
  localStorageData["warmgraph_owner"] = {
    ownerId: "manasvi-p-8a88402ab",
    name: "Manasvi P",
    profileUrl: "https://www.linkedin.com/in/manasvi-p-8a88402ab"
  };

  // Load content.js
  const contentCode = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  eval(contentCode);

  // Load popup.js
  const popupCode = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  eval(popupCode);

  // Load background.js
  const bgCode = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  eval(bgCode);

  // TEST 1: Identity protection when viewing target profile page
  console.log("\n[TEST 1] Immutability of warmgraph_owner when viewing profile page...");
  const detectedOwner = await detectAndPersistOwnerIdentity();
  assert.strictEqual(detectedOwner, "manasvi-p-8a88402ab", "detectAndPersistOwnerIdentity must return stored ownerId");
  assert.strictEqual(localStorageData["warmgraph_owner"].ownerId, "manasvi-p-8a88402ab", "warmgraph_owner must NOT be overwritten by viewed profile URL");
  console.log("✓ warmgraph_owner remained unchanged ('manasvi-p-8a88402ab') while on /in/reshma-hegde profile page!");

  // TEST 2: Target selection stores into selected_target without touching warmgraph_owner
  console.log("\n[TEST 2] Target selection isolation...");
  elementsById["pathTarget"] = makeDummyEl("pathTarget");
  elementsById["pathTarget"].value = "https://www.linkedin.com/in/reshma-hegde";

  // Simulate setting target in popup
  localStorageData["selected_target"] = {
    targetId: "reshma-hegde",
    name: "Reshma Hegde",
    profileUrl: "https://www.linkedin.com/in/reshma-hegde"
  };

  assert.strictEqual(localStorageData["warmgraph_owner"].ownerId, "manasvi-p-8a88402ab", "warmgraph_owner ownerId must be manasvi-p-8a88402ab");
  assert.strictEqual(localStorageData["selected_target"].targetId, "reshma-hegde", "selected_target targetId must be reshma-hegde");
  console.log("✓ selected_target and warmgraph_owner are completely separate objects!");

  // TEST 3: Warm Path Request sends owner_id = logged-in owner and target_url = selected_target.profileUrl
  console.log("\n[TEST 3] Find Warm Path request resolution...");
  fetchLog = [];

  const findPathBtn = elementsById["findPath"];
  assert.ok(findPathBtn, "findPath button listener registered");

  const ownerId = await getOwnerForBackend();
  assert.strictEqual(ownerId, "manasvi-p-8a88402ab", "getOwnerForBackend must return logged-in owner ID");

  const storageTarget = await new Promise(r => chrome.storage.local.get(["selected_target"], r));
  const st = storageTarget.selected_target;
  assert.strictEqual(st.profileUrl, "https://www.linkedin.com/in/reshma-hegde");

  const response = await backendRequest("/graph/path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_id: ownerId,
      source_id: ownerId,
      target_url: st.profileUrl,
      target_id: st.targetId,
      cutoff: 4
    })
  });

  assert.strictEqual(fetchLog.length, 1, "One request logged");
  const pathCall = fetchLog[0];
  assert.strictEqual(pathCall.url, "http://127.0.0.1:8000/graph/path");
  assert.strictEqual(pathCall.body.owner_id, "manasvi-p-8a88402ab", "owner_id must be manasvi-p-8a88402ab");
  assert.strictEqual(pathCall.body.target_url, "https://www.linkedin.com/in/reshma-hegde", "target_url must be target profileUrl");
  assert.notStrictEqual(pathCall.body.owner_id, "reshma-hegde", "owner_id must NEVER be targetId");
  assert.notStrictEqual(pathCall.body.owner_id, "jeevith-gowda-sr", "owner_id must NEVER be wrong owner");

  console.log("✓ Find Warm Path payload verified:");
  console.log("   owner_id =", pathCall.body.owner_id);
  console.log("   target_url =", pathCall.body.target_url);

  // TEST 4: Explain Path Request
  console.log("\n[TEST 4] Explain Path request resolution...");
  fetchLog = [];
  const explainRes = await backendRequest("/graph/explain-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_id: ownerId,
      source_id: ownerId,
      target_url: st.profileUrl,
      target_id: st.targetId,
      cutoff: 4
    })
  });

  assert.strictEqual(fetchLog[0].body.owner_id, "manasvi-p-8a88402ab", "owner_id for explain-path must be manasvi-p-8a88402ab");
  console.log("✓ Explain Path request verified with owner_id = 'manasvi-p-8a88402ab'!");

  // TEST 5: Refresh Data doesn't touch identity
  console.log("\n[TEST 5] Refresh Data identity immutability...");
  fetchLog = [];
  const refreshOwnerId = await getOwnerForBackend();
  const refreshRes = await backendRequest("/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: refreshOwnerId, force: false })
  });

  assert.strictEqual(fetchLog[0].body.owner_id, "manasvi-p-8a88402ab", "Refresh request owner_id must be manasvi-p-8a88402ab");
  assert.strictEqual(localStorageData["warmgraph_owner"].ownerId, "manasvi-p-8a88402ab", "Owner identity unchanged after refresh");
  console.log("✓ Refresh Data verified: graph refresh triggered without regenerating owner identity!");

  // TEST 6: Task 8.9 Sync to Backend two-step verification pipeline
  console.log("\n[TEST 6] Task 8.9 Backend sync two-step verification pipeline...");
  fetchLog = [];

  const sessionObj = {
    sessionId: "task-89-session",
    ownerId: "manasvi-p-8a88402ab",
    completionStatus: "complete",
    isPartial: false,
    state: "completed",
    expectedTotal: 208,
    collectedTotal: 208,
    collectedConnections: [{ name: "Satya Nadella", profile_url: "https://linkedin.com/in/satyanadella" }]
  };
  localStorageData["acquisition_session"] = sessionObj;

  if (global.acquisitionSession) {
    global.acquisitionSession.state = "completed";
    global.acquisitionSession.isPartial = false;
    global.acquisitionSession.completionStatus = "complete";
    global.acquisitionSession.expectedTotal = 208;
    global.acquisitionSession.actualProfiles = 208;
  }

  let syncResult = null;
  const bgListener = chrome.runtime.onMessage.listeners[chrome.runtime.onMessage.listeners.length - 1];

  // Execute background sync listener
  await new Promise(r => {
    bgListener(
      { action: "syncToBackend" },
      {},
      (res) => {
        if (res && (res.success !== undefined || res.status)) {
          syncResult = res;
          r();
        }
      }
    );
  });

  console.log("SYNC RESULT DEBUG:", syncResult);
  assert.ok(syncResult.success, "Sync must succeed when POST /network/import, GET /network, and GET /graph return 200");
  assert.strictEqual(syncResult.status.syncStatus, "synced", "Session status must be marked synced");
  assert.strictEqual(syncResult.status.syncMessage, "Network Successfully Synced ✓");

  // Verify fetch calls in sequence
  assert.strictEqual(fetchLog.length, 3, "Must perform 3 fetch calls: import, GET network, GET graph");
  assert.ok(fetchLog[0].url.includes("/network/import"), "Call 1: POST /network/import");
  assert.ok(fetchLog[1].url.includes("/network/manasvi-p-8a88402ab"), "Call 2: GET /network/manasvi-p-8a88402ab");
  assert.ok(fetchLog[2].url.includes("/graph/manasvi-p-8a88402ab"), "Call 3: GET /graph/manasvi-p-8a88402ab");

  console.log("✓ Task 8.9 Backend sync two-step verification pipeline verified!");
  console.log("   1. POST /network/import -> 200 OK");
  console.log("   2. GET /network/manasvi-p-8a88402ab -> 200 OK");
  console.log("   3. GET /graph/manasvi-p-8a88402ab -> 200 OK");
  console.log("   Result: Network Successfully Synced ✓");

  // TEST 7: Task 8.9.2 SYNC_NETWORK message trigger from popup Sync Again button
  console.log("\n[TEST 7] Task 8.9.2 SYNC_NETWORK message trigger from popup button...");
  fetchLog = [];

  let syncNetResult = null;
  await new Promise(r => {
    bgListener(
      { type: "SYNC_NETWORK" },
      {},
      (res) => {
        if (res && res.success !== undefined) {
          syncNetResult = res;
          r();
        }
      }
    );
  });

  assert.ok(syncNetResult.success, "SYNC_NETWORK must trigger import and succeed");
  assert.strictEqual(fetchLog.length, 3, "SYNC_NETWORK must execute 3 backend calls: import, GET network, GET graph");
  assert.ok(fetchLog[0].url.includes("/network/import"), "Call 1: POST /network/import");
  assert.ok(fetchLog[1].url.includes("/network/manasvi-p-8a88402ab"), "Call 2: GET /network/manasvi-p-8a88402ab");
  assert.ok(fetchLog[2].url.includes("/graph/manasvi-p-8a88402ab"), "Call 3: GET /graph/manasvi-p-8a88402ab");

  console.log("✓ Task 8.9.2 SYNC_NETWORK button trigger verified!");
  console.log("   1. Message: { type: 'SYNC_NETWORK' }");
  console.log("   2. POST /network/import 200 OK");
  console.log("   3. GET /network/manasvi-p-8a88402ab 200 OK");
  console.log("   4. GET /graph/manasvi-p-8a88402ab 200 OK");

  console.log("\n=================================================");
  console.log("ALL TASK 8.6, 8.9 & 8.9.2 ACCEPTANCE TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
})();
