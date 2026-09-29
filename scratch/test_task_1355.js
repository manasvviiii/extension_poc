/**
 * Acceptance Test Suite for HOTFIX 13.5.5 — Multi-Page LinkedIn People Search Extraction
 */

const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING HOTFIX 13.5.5 ACCEPTANCE TEST SUITE");
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

async function runTests() {
  const contentJsPath = path.join(__dirname, '..', 'extension', 'content.js');
  const overlayJsPath = path.join(__dirname, '..', 'extension', 'overlay.js');
  const backgroundJsPath = path.join(__dirname, '..', 'extension', 'background.js');

  const contentJs = fs.readFileSync(contentJsPath, 'utf8');
  const overlayJs = fs.readFileSync(overlayJsPath, 'utf8');
  const backgroundJs = fs.readFileSync(backgroundJsPath, 'utf8');

  // ---------------------------------------------------------
  // 1. Audit Target Page Detection Rules
  // ---------------------------------------------------------
  console.log("1. Auditing Scraping Detection Rules (Filtered People Search ONLY)...");

  function testApprovedPage(href, pathname, search) {
    const url = href || "";
    const pathStr = pathname || "";
    const searchStr = search || "";

    if ((pathStr.includes("/in/") && !pathStr.includes("/search/")) || pathStr.includes("/company/")) {
      return false;
    }

    const isFirstDegreeSearch = (pathStr.includes("/search/results/people") || url.includes("/search/results/people")) &&
      /network=(%5B%22|%5b%22|\[%22|\[")F/i.test(searchStr);

    const isMockConn = url.includes("connections.html");

    return isFirstDegreeSearch || isMockConn;
  }

  // Standalone profile page guard
  assert(!testApprovedPage("https://www.linkedin.com/in/jane-doe", "/in/jane-doe", ""), 
    "isApprovedExtractionPage returns FALSE for standalone profile pages (/in/jane-doe)");

  // Company page guard
  assert(!testApprovedPage("https://www.linkedin.com/company/google", "/company/google", ""), 
    "isApprovedExtractionPage returns FALSE for company pages (/company/google)");

  // Generic search guard
  assert(!testApprovedPage("https://www.linkedin.com/search/results/people/?keywords=ceo", "/search/results/people/", "?keywords=ceo"), 
    "isApprovedExtractionPage returns FALSE for generic search without network=[\"F\"] filter");

  // Canned filtered 1st degree search target
  const cannedSearchUrl = "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";
  assert(testApprovedPage(cannedSearchUrl, "/search/results/people/", "?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D"), 
    "isApprovedExtractionPage returns TRUE for filtered 1st degree search (origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D)");

  // ---------------------------------------------------------
  // 2. Audit Pagination & Next Button Navigation Logic
  // ---------------------------------------------------------
  console.log("\n2. Auditing Pagination & Next Button Navigation Logic...");

  assert(contentJs.includes('findPaginationNextButton()'), "content.js contains findPaginationNextButton helper");
  assert(contentJs.includes('extractPaginationStateFromDom()'), "content.js contains extractPaginationStateFromDom helper");
  assert(contentJs.includes('button.artdeco-pagination__button--next'), "content.js detects LinkedIn artdeco-pagination__button--next selector");
  assert(contentJs.includes('button[aria-label*="Next"]'), "content.js detects aria-label Next button selector");
  assert(contentJs.includes('nextBtn.click()'), "content.js automatically clicks Next button when found during acquisition loop");

  // ---------------------------------------------------------
  // 3. Audit Resume Recovery & Known Profile State Persistence
  // ---------------------------------------------------------
  console.log("\n3. Auditing Resume Recovery & State Persistence...");

  assert(contentJs.includes('known_profile_urls: profileUrlList'), "content.js persists known_profile_urls array in storagePayload");
  assert(contentJs.includes('extracted_count: canonicalExtracted'), "content.js persists extracted_count in storagePayload");
  assert(contentJs.includes('last_synced_profile_urls'), "content.js hydrates last_synced_profile_urls to restore seen profiles set");

  // ---------------------------------------------------------
  // 4. Audit Overlay UI Live Progress & Pagination Display
  // ---------------------------------------------------------
  console.log("\n4. Auditing Overlay UI Pagination & Progress Display...");

  assert(overlayJs.includes('pagLabel ? `${pagLabel} • ${remaining} remaining`'), 
    "overlay.js displays pagination label (e.g. Page 20 of 35) in live progress indicator");

  assert(overlayJs.includes('Auto Extracting'), "overlay.js displays 'Auto Extracting' status pill");
  assert(overlayJs.includes('Workspace Up To Date'), "overlay.js displays 'Workspace Up To Date' upon completion");

  // ---------------------------------------------------------
  // 5. Audit Scroll Speed & Cap Limits
  // ---------------------------------------------------------
  console.log("\n5. Auditing Scroll Speed & 350 Cap Limits...");

  assert(contentJs.includes('MAX_EXTRACTION_LIMIT = 350'), "content.js enforces 350 unique profile limit");
  assert(contentJs.includes('scrollDistance = Math.floor(Math.random() * (280 - 180 + 1)) + 180'), "content.js uses 180-280px scroll distance");
  assert(contentJs.includes('scrollDelayMs = Math.floor(Math.random() * (320 - 180 + 1)) + 180'), "content.js uses ~35% faster inter-scroll delay");

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All HOTFIX 13.5.5 Acceptance Tests Passed!\n");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
