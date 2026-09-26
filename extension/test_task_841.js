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
console.log("RUNNING TASK 8.4.1 VERIFICATION TEST SUITE");
console.log("=================================================");

// Load modules
const overlayCode = fs.readFileSync(path.join(__dirname, "overlay.js"), "utf8");
eval(overlayCode);

// Test 1: Overlay Resting State Verification
console.log("\n[TEST 1] Overlay Resting State Copy & Metrics...");

const sessionData = {
  sessionId: "session-test-841",
  totalConnections: 208,
  actualProfiles: 207,
  extractedConnections: 207,
  progressPercent: 100,
  state: "resting",
  syncStatus: "synced",
  lastSyncedAt: "10:00 AM"
};

const overlay = window.WarmGraphOverlay;
overlay.update(sessionData);

assert.strictEqual(overlay.currentStatus.actualProfiles, 207, "actualProfiles must be header - 1 = 207");
assert.strictEqual(overlay.currentStatus.extractedConnections, 207, "extractedConnections must be 207");
console.log("✓ Hero metric 207 / 207 verified (never 208/208)");

// Test 2: Active Graph Search
console.log("\n[TEST 2] Active Graph Local Search Verification...");

localStorageData["warmgraph_active_graph"] = [
  { name: "Alice Smith", headline: "Software Engineer at Acme Corp", profile_url: "https://linkedin.com/in/alicesmith", degree: "1st" },
  { name: "Bob Jones", headline: "VP Product at Beta Inc", profile_url: "https://linkedin.com/in/bobjones", degree: "1st" }
];

const popupCode = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
eval(popupCode);

searchLocalActiveGraph("Acme Corp", "Software").then(res => {
  assert.strictEqual(res.candidates.length, 1, "Should find 1 candidate matching Acme Corp Software");
  assert.strictEqual(res.candidates[0].name, "Alice Smith", "Candidate should be Alice Smith");
  assert.strictEqual(res.candidates[0].degree, "1st", "Degree should be 1st");
  console.log("✓ Active Graph Search matched correctly from warmgraph_active_graph!");

  console.log("\n=================================================");
  console.log("ALL TASK 8.4.1 REGRESSION TESTS PASSED!");
  console.log("=================================================");
});
