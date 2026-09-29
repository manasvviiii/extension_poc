/**
 * ACCEPTANCE TEST SUITE FOR TASK 13.5.7
 * Dual Acquisition Engine (Preserve Connections + Add People Search)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passes = 0;
let fails = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passes++;
  } else {
    console.error(`[FAIL] ${message}`);
    fails++;
  }
}

async function runTestSuite() {
  console.log("=================================================");
  console.log("RUNNING TASK 13.5.7 ACCEPTANCE TEST SUITE");
  console.log("=================================================\n");

  const contentJsPath = path.join(__dirname, '..', 'extension', 'content.js');
  const overlayJsPath = path.join(__dirname, '..', 'extension', 'overlay.js');

  const contentCode = fs.readFileSync(contentJsPath, 'utf-8');
  const overlayCode = fs.readFileSync(overlayJsPath, 'utf-8');

  // =========================================================================
  // 1. Audit Code structure & function existence
  // =========================================================================
  console.log("1. Auditing Code Structure & Engine Selection Helper...");

  assert(contentCode.includes('function getAcquisitionEngineType()'), "content.js defines getAcquisitionEngineType helper");
  assert(contentCode.includes('return "CONNECTIONS";'), "getAcquisitionEngineType returns 'CONNECTIONS' for connections page");
  assert(contentCode.includes('return "PEOPLE_SEARCH";'), "getAcquisitionEngineType returns 'PEOPLE_SEARCH' for filtered search");
  assert(contentCode.includes('window.getAcquisitionEngineType = getAcquisitionEngineType;'), "content.js exports getAcquisitionEngineType on window");

  // =========================================================================
  // 2. Setup Lightweight Sandbox for Function Execution
  // =========================================================================
  console.log("\n2. Executing Function Logic in Sandbox...");

  const mockListeners = [];

  class MockMutationObserver {
    observe() {}
    disconnect() {}
  }

  // Minimal Browser Sandbox
  const sandbox = {
    MutationObserver: MockMutationObserver,
    window: {
      location: {
        href: "https://www.linkedin.com/feed/",
        pathname: "/feed/",
        search: ""
      },
      addEventListener: (type, fn) => mockListeners.push({ type, fn }),
      removeEventListener: () => {},
      dispatchEvent: () => {}
    },
    document: {
      body: { innerText: "", textContent: "" },
      documentElement: { innerText: "", textContent: "" },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (type, fn) => mockListeners.push({ type, fn }),
      removeEventListener: () => {}
    },
    chrome: {
      storage: {
        local: {
          get: (k, cb) => cb({}),
          set: (d, cb) => cb && cb()
        },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: () => {}
      }
    },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    URL: global.URL,
    Map: Map,
    Set: Set,
    Array: Array,
    Object: Object,
    Date: Date,
    Math: Math,
    RegExp: RegExp,
    parseInt: parseInt,
    isNaN: isNaN
  };

  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  vm.runInContext(contentCode, sandbox);

  // Test Engine A URL (/mynetwork/invite-connect/connections)
  sandbox.window.location.href = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
  sandbox.window.location.pathname = "/mynetwork/invite-connect/connections/";
  sandbox.window.location.search = "";

  const engineA = sandbox.getAcquisitionEngineType();
  assert(engineA === "CONNECTIONS", "getAcquisitionEngineType returns 'CONNECTIONS' for /mynetwork/invite-connect/connections/");
  assert(sandbox.isApprovedExtractionPage() === true, "isApprovedExtractionPage returns TRUE for Engine A");

  // Test test mock connections.html
  sandbox.window.location.href = "http://localhost/connections.html";
  sandbox.window.location.pathname = "/connections.html";

  const engineAMock = sandbox.getAcquisitionEngineType();
  assert(engineAMock === "CONNECTIONS", "getAcquisitionEngineType returns 'CONNECTIONS' for connections.html test mock");

  // Test Engine B URL (Filtered 1st degree People Search)
  sandbox.window.location.href = "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";
  sandbox.window.location.pathname = "/search/results/people/";
  sandbox.window.location.search = "?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";

  const engineB = sandbox.getAcquisitionEngineType();
  assert(engineB === "PEOPLE_SEARCH", "getAcquisitionEngineType returns 'PEOPLE_SEARCH' for network=[\"F\"] search");
  assert(sandbox.isApprovedExtractionPage() === true, "isApprovedExtractionPage returns TRUE for Engine B");

  // Test unapproved URLs
  sandbox.window.location.href = "https://www.linkedin.com/in/jane-doe/";
  sandbox.window.location.pathname = "/in/jane-doe/";
  sandbox.window.location.search = "";

  assert(sandbox.getAcquisitionEngineType() === null, "getAcquisitionEngineType returns NULL for profile pages");
  assert(sandbox.isApprovedExtractionPage() === false, "isApprovedExtractionPage returns FALSE for profile pages");

  sandbox.window.location.href = "https://www.linkedin.com/search/results/people/?keywords=software";
  sandbox.window.location.pathname = "/search/results/people/";
  sandbox.window.location.search = "?keywords=software";

  assert(sandbox.getAcquisitionEngineType() === null, "getAcquisitionEngineType returns NULL for generic search without network=[\"F\"]");

  // =========================================================================
  // 3. Audit Engine A vs Engine B DOM Total Handling
  // =========================================================================
  console.log("\n3. Auditing DOM Total Connection Count Handling...");

  // On Engine A (Connections page)
  sandbox.window.location.href = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
  sandbox.window.location.pathname = "/mynetwork/invite-connect/connections/";
  sandbox.window.location.search = "";

  sandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('h1') || sel.includes('header')) {
      return [{ innerText: "Connections (1,542)", textContent: "Connections (1,542)" }];
    }
    return [];
  };

  const connDomTotal = sandbox.extractTotalConnectionsFromDom();
  assert(connDomTotal === 1542, "extractTotalConnectionsFromDom extracts 1542 header count on Engine A (Connections)");

  // On Engine B (People Search page)
  sandbox.window.location.href = "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";
  sandbox.window.location.pathname = "/search/results/people/";
  sandbox.window.location.search = "?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";

  sandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('h2') || sel.includes('search-results')) {
      return [{ innerText: "20 results", textContent: "20 results" }];
    }
    return [];
  };

  const searchDomTotal = sandbox.extractTotalConnectionsFromDom();
  assert(searchDomTotal === null, "extractTotalConnectionsFromDom returns NULL on Engine B (People Search) to prevent overriding cap");

  // =========================================================================
  // 4. Audit Graph Storage & Profile URL Deduplication
  // =========================================================================
  console.log("\n4. Auditing Unified Graph Repository & Profile URL Deduplication...");

  const session = sandbox.window.acquisitionSession;
  session.connections = new Map();
  session.seenProfiles = new Set();

  const recordEngineA = {
    name: "Manasvi V",
    headline: "AI Engineer",
    company: "Google",
    profile_url: "https://www.linkedin.com/in/manasvi-v-123/",
    degree: "1st"
  };

  const key1 = session.getDeduplicationKey(recordEngineA);
  session.seenProfiles.add(key1);
  session.connections.set(key1, recordEngineA);

  assert(session.connections.size === 1, "Graph repository stores Engine A record");

  // Same profile collected via Engine B
  const recordEngineB = {
    name: "Manasvi V",
    headline: "Lead AI Engineer",
    company: "Google",
    profile_url: "https://www.linkedin.com/in/manasvi-v-123", // trailing slash omitted
    degree: "1st"
  };

  const key2 = session.getDeduplicationKey(recordEngineB);
  assert(key1 === key2, "Normalized profile_url keys match despite trailing slash differences");

  if (session.seenProfiles.has(key2)) {
    const existing = session.connections.get(key2);
    session.connections.set(key2, { ...existing, ...recordEngineB });
  }

  assert(session.connections.size === 1, "Graph size remains 1 (strictly deduplicated across engines)");
  assert(session.connections.get(key1).headline === "Lead AI Engineer", "Profile record merged and updated cleanly");

  // =========================================================================
  // 5. Audit Overlay UI Adaptation for Both Engines
  // =========================================================================
  console.log("\n5. Auditing Overlay UI Adaptation (Engine A vs Engine B)...");

  assert(overlayCode.includes('isPeopleSearch ? "Profiles Indexed" : "Network mapped"'), "overlay.js switches hero card title between engines");
  assert(overlayCode.includes('heroMetricEl.textContent = `${displayLeft} Total`'), "overlay.js formats hero metric for completed PEOPLE_SEARCH engine");
  assert(overlayCode.includes('heroRemainingEl.textContent = `${pageCount} ${pageCount === 1 ? "Page" : "Pages"} Processed • Last Sync: Just now`'), "overlay.js formats hero subtitle for completed PEOPLE_SEARCH engine");
  assert(overlayCode.includes('showCta: false'), "overlay.js completely removes Sync Again button upon completion");

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passes} PASSED, ${fails} FAILED`);
  console.log("-----------------------------------------");

  if (fails > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All TASK 13.5.7 Acceptance Tests Passed!\n");
  }
}

runTestSuite().catch(err => {
  console.error("Test execution error:", err);
  process.exit(1);
});
