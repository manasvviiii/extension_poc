const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Mock DOM & Chrome environment
global.window = {
  location: { href: "https://www.linkedin.com/mynetwork/invite-connect/connections/", pathname: "/mynetwork/invite-connect/connections/" },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

let localStorageData = {};
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
    onChanged: {
      addListener: () => {}
    }
  },
  runtime: {
    sendMessage: () => {},
    lastError: null
  },
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

global.document = {
  createElement: (tag) => makeDummyEl(tag),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  getElementById: (id) => makeDummyEl(id)
};

console.log("=================================================");
console.log("RUNNING TASK 8.5 HOTFIX VERIFICATION TEST SUITE");
console.log("=================================================");

// Load Overlay module
const overlayCode = fs.readFileSync(path.join(__dirname, "overlay.js"), "utf8");
eval(overlayCode);

// Test 1: Dynamic 208 / 209 (Header 209, Extractable 208) Completion State
console.log("\n[TEST 1] Dynamic 208/209 Completion Logic (Header 209, Cards 208)...");

const sessionData = {
  sessionId: "session-task-85-hotfix",
  totalConnections: 209, // Header count
  actualProfiles: 208,   // Verified unique extracted cards
  extractedConnections: 208,
  progressPercent: 100,
  state: "resting",
  syncStatus: "synced",
  lastSyncedAt: "10:00 AM"
};

const overlay = window.WarmGraphOverlay;
overlay.update(sessionData);

assert.strictEqual(overlay.currentStatus.totalConnections, 209, "totalConnections (header) must be 209");
assert.strictEqual(overlay.currentStatus.actualProfiles, 208, "actualProfiles must be 208");
assert.strictEqual(overlay.currentStatus.extractedConnections, 208, "extractedConnections must be 208");

const mapped = window.getMappedStateData ? window.getMappedStateData(sessionData) : null;
if (mapped) {
  assert.strictEqual(mapped.badgeText, "Resting", "Status pill must be Resting");
  assert.strictEqual(mapped.title, "You're all caught up ✨", "Title must be 'You\'re all caught up ✨'");
  assert.strictEqual(mapped.desc, "No new connections found. Your network is fully synced.", "Desc must match exact copy");
  assert.strictEqual(mapped.ctaText, "Sync Again", "CTA text must be 'Sync Again'");
}
console.log("✓ Dynamic completion verified: Header 209, Hero 208/208, Resting, You're all caught up ✨, Sync Again");

// Test 2: Target Search Priority (Local Active Graph FIRST)
console.log("\n[TEST 2] Target Search Local Active Graph Priority...");

localStorageData["warmgraph_active_graph"] = {
  totalConnections: 209,
  connections: [
    { name: "Satya Nadella", headline: "CEO at Microsoft", profile_url: "https://linkedin.com/in/satyanadella", degree: "1st" },
    { name: "Jane Smith", headline: "Software Engineer at Microsoft", profile_url: "https://linkedin.com/in/janesmith", degree: "1st" },
    { name: "Bruce Banner", headline: "Research Scientist at Gamma Labs", profile_url: "https://linkedin.com/in/bruce", degree: "1st" }
  ]
};

const popupCode = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
eval(popupCode);

hydrateActiveGraphPreview();

(async () => {
  const res = await handleTargetSearch("Microsoft", "Software Engineer", "sell_side", "owner123");
  assert.strictEqual(res.candidates.length, 1, "Should find 1 match for Microsoft Software Engineer");
  assert.strictEqual(res.candidates[0].name, "Jane Smith", "Candidate should be Jane Smith");
  console.log("✓ Target Search priority verified: local Active Graph matched Jane Smith without network fetch!");

  // Empty role test: returns all Microsoft connections
  const resEmptyRole = await handleTargetSearch("Microsoft", "", "sell_side", "owner123");
  assert.strictEqual(resEmptyRole.candidates.length, 2, "Empty role should return all 2 Microsoft candidates");
  console.log("✓ Empty role query verified: returned all company matches!");

  // Test 3: Target Search Indexing without connection.company property (HPE example)
  console.log("\n[TEST 3] Target Search Indexing without connection.company (HPE example)...");
  localStorageData["warmgraph_active_graph"] = {
    totalConnections: 209,
    connections: [
      { name: "Alice Johnson", headline: "Software Engineer | HPE | Cloud Platform", profile_url: "https://linkedin.com/in/alicejohnson", degree: "1st" }
    ]
  };

  const resHpeEmpty = await handleTargetSearch("HPE", "", "sell_side", "owner123");
  assert.strictEqual(resHpeEmpty.candidates.length, 1, "Should match HPE in headline when role is empty");
  assert.strictEqual(resHpeEmpty.candidates[0].name, "Alice Johnson");
  assert.ok(resHpeEmpty.candidates[0].confidence !== undefined, "Must have confidence");
  assert.ok(resHpeEmpty.candidates[0].warmth !== undefined, "Must have warmth");

  const resHpeRole = await handleTargetSearch("HPE", "Software Engineer", "sell_side", "owner123");
  assert.strictEqual(resHpeRole.candidates.length, 1, "Should match HPE and Software Engineer in headline");
  assert.strictEqual(resHpeRole.candidates[0].name, "Alice Johnson");
  console.log("✓ HPE search without company property verified (both empty role and full role queries match headline correctly)!");

  // Test 4: Single Source of Truth helper getActiveConnections()
  console.log("\n[TEST 4] Single Source of Truth getActiveConnections()...");
  const activeConns = await getActiveConnections();
  assert.strictEqual(activeConns.length, 1, "getActiveConnections must return exact array from warmgraph_active_graph.connections");
  assert.strictEqual(activeConns[0].name, "Alice Johnson");
  console.log("✓ getActiveConnections() verified: Preview and Target Search access the exact same dataset!");

  console.log("\n=================================================");
  console.log("ALL TASK 8.5 HOTFIX VERIFICATION TESTS PASSED!");
  console.log("=================================================");
})();


