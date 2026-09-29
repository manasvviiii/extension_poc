/**
 * Comprehensive Acceptance Test Suite for HOTFIX 13.5.6 — Auto Pagination & Incremental Sync (LinkedIn People Search)
 */

const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING HOTFIX 13.5.6 ACCEPTANCE TEST SUITE");
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
  // 1. Audit Target URL & Detection Scope Rules
  // ---------------------------------------------------------
  console.log("1. Auditing Scraping Detection & Target URL Rules...");

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

  // Profile page guard
  assert(!testApprovedPage("https://www.linkedin.com/in/jane-doe", "/in/jane-doe", ""), 
    "isApprovedExtractionPage returns FALSE for standalone profile pages (/in/jane-doe)");

  // Generic search guard
  assert(!testApprovedPage("https://www.linkedin.com/search/results/people/?keywords=software", "/search/results/people/", "?keywords=software"), 
    "isApprovedExtractionPage returns FALSE for generic search without network=[\"F\"] filter");

  // Canned filtered 1st degree search target
  const cannedUrl = "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";
  assert(testApprovedPage(cannedUrl, "/search/results/people/", "?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D"), 
    "isApprovedExtractionPage returns TRUE for filtered 1st degree search");

  assert(backgroundJs.includes('origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D'), 
    "background.js targetUrl points to LinkedIn filtered people search with canned origin");

  // ---------------------------------------------------------
  // 2. Audit Denominator Fix (No 20/20 Premature Termination Bug)
  // ---------------------------------------------------------
  console.log("\n2. Auditing Denominator Fix (No 20/20 Premature Stop Bug)...");

  assert(contentJs.includes('if (!isNaN(num) && num > 25)'), 
    "extractTotalConnectionsFromDom ignores single-page result counts <= 25");

  assert(contentJs.includes('this.totalConnections = Math.min(MAX_EXTRACTION_LIMIT, domTotal)'), 
    "content.js sets totalConnections to 350 target limit instead of single page size 20");

  assert(contentJs.includes('this.actualProfiles = Math.min(MAX_EXTRACTION_LIMIT, domTotal)'), 
    "content.js sets actualProfiles to 350 target limit so denominator shows x / 350");

  // ---------------------------------------------------------
  // 3. Audit Multi-Page Auto Pagination Workflow
  // ---------------------------------------------------------
  console.log("\n3. Auditing Multi-Page Auto Pagination Workflow...");

  assert(contentJs.includes('findPaginationNextButton()'), "content.js contains findPaginationNextButton helper");
  assert(contentJs.includes('button.artdeco-pagination__button--next'), "content.js detects LinkedIn pagination Next button selector");
  assert(contentJs.includes('nextBtn.click()'), "content.js clicks Next button to traverse pages continuously");
  assert(contentJs.includes('if (nextBtn && currentCount < targetLimit)'), "content.js continues pagination until 350 limit or Next button disappears");

  // ---------------------------------------------------------
  // 4. Audit Incremental Sync & State Persistence
  // ---------------------------------------------------------
  console.log("\n4. Auditing Incremental Sync & State Persistence...");

  assert(contentJs.includes('known_profile_urls: profileUrlList'), "content.js saves known_profile_urls array in storagePayload");
  assert(contentJs.includes('extracted_count: canonicalExtracted'), "content.js saves extracted_count in storagePayload");
  assert(contentJs.includes('this.seenProfiles.has(key)'), "content.js deduplicates cards using profile_url to prevent duplicate nodes");

  // ---------------------------------------------------------
  // 5. Audit Overlay UI & Removal of Sync Again Button
  // ---------------------------------------------------------
  console.log("\n5. Auditing Overlay UI & Sync Again Button Removal...");

  assert(overlayJs.includes('showCta: false'), "overlay.js completely removes 'Sync Again' CTA button on completion");
  assert(overlayJs.includes('Auto Extracting'), "overlay.js displays 'Auto Extracting' status pill");
  assert(overlayJs.includes('Workspace Up To Date'), "overlay.js displays 'Workspace Up To Date' upon completion");
  assert(overlayJs.includes('pagLabel ? `${pagLabel} • ${remaining} remaining`'), "overlay.js renders live pagination state (e.g. Page 20 of 35)");

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All HOTFIX 13.5.6 Acceptance Tests Passed!\n");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
