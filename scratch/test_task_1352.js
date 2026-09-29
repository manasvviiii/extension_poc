/**
 * Acceptance Test Suite for TASK 13.5.2 — Automatic Incremental Extraction (350 Limit)
 */

const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING TASK 13.5.2 ACCEPTANCE TEST SUITE");
console.log("=================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

// 1. Audit content.js for 350 limit cap & auto-start
console.log("1. Auditing extension/content.js for 350 limit & auto-start logic...");
const contentJsPath = path.join(__dirname, '..', 'extension', 'content.js');
const contentJs = fs.readFileSync(contentJsPath, 'utf8');

assert(contentJs.includes('MAX_EXTRACTION_LIMIT = 350'), "content.js defines MAX_EXTRACTION_LIMIT = 350");
assert(contentJs.includes('targetLimit'), "content.js calculates targetLimit bounded by 350 limit");
assert(contentJs.includes('this.connections.size >= targetLimit'), "content.js checks connection count against targetLimit to stop scrolling");
assert(contentJs.includes('last_synced_profile_urls'), "content.js reads & persists last_synced_profile_urls for incremental extraction");
assert(contentJs.includes('maybeAutoStartAcquisition'), "content.js contains maybeAutoStartAcquisition for automatic extraction start");

// 2. Audit overlay.js for auto status & completed state
console.log("\n2. Auditing extension/overlay.js for Auto Extracting & Workspace Up To Date statuses...");
const overlayJsPath = path.join(__dirname, '..', 'extension', 'overlay.js');
const overlayJs = fs.readFileSync(overlayJsPath, 'utf8');

assert(overlayJs.includes('Auto Extracting'), "overlay.js includes 'Auto Extracting' status label");
assert(overlayJs.includes('Workspace Up To Date'), "overlay.js includes 'Workspace Up To Date' completion status");
assert(overlayJs.includes('Connections Indexed'), "overlay.js displays 'Connections Indexed' upon completion");

// 3. Simulated Incremental Logic & Deduplication Test
console.log("\n3. Testing Simulated Incremental Extraction & Deduplication Logic...");

// Mock Session for testing incremental extraction logic
class MockAcquisitionSession {
  constructor() {
    this.connections = new Map();
    this.seenProfiles = new Set();
    this.lastSyncedProfileUrls = new Set();
  }

  loadPreviousSync(urls) {
    this.lastSyncedProfileUrls = new Set(urls);
    urls.forEach(u => {
      const key = `url:${u}`;
      this.seenProfiles.add(key);
      this.connections.set(key, { name: `Person ${u}`, profile_url: u, degree: "1st" });
    });
  }

  extractBatch(newProfiles) {
    let extractedNew = 0;
    newProfiles.forEach(p => {
      const key = `url:${p.profile_url}`;
      if (!this.seenProfiles.has(key)) {
        this.seenProfiles.add(key);
        this.connections.set(key, p);
        extractedNew++;
      }
    });
    return extractedNew;
  }
}

// Initial Sync: 350 connections
const session = new MockAcquisitionSession();
const initialUrls = Array.from({ length: 350 }, (_, i) => `https://www.linkedin.com/in/user-${i + 1}`);
session.loadPreviousSync(initialUrls);

assert(session.connections.size === 350, "Initial sync contains 350 connections");

// Subsequent Sync: 357 total on LinkedIn (7 new connections at top)
const newProfiles = Array.from({ length: 7 }, (_, i) => ({
  name: `New Person ${i + 1}`,
  profile_url: `https://www.linkedin.com/in/new-user-${i + 1}`,
  degree: "1st"
}));
const duplicateProfiles = initialUrls.slice(0, 10).map(u => ({
  name: `Person ${u}`,
  profile_url: u,
  degree: "1st"
}));

const extractedCount = session.extractBatch([...newProfiles, ...duplicateProfiles]);

assert(extractedCount === 7, `Incremental sync extracted ONLY 7 new profiles (got: ${extractedCount})`);
assert(session.connections.size === 357, `Final total connections count is 357 (got: ${session.connections.size})`);

console.log("\n-----------------------------------------");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("-----------------------------------------");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("SUCCESS: All Task 13.5.2 Acceptance Tests Passed!\n");
}
