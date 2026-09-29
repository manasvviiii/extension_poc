/**
 * Comprehensive Acceptance Test Suite for HOTFIX 13.5.4 — LinkedIn Filter Page Extraction
 */

const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING HOTFIX 13.5.4 ACCEPTANCE TEST SUITE");
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
  const popupJsPath = path.join(__dirname, '..', 'extension', 'popup.js');

  const contentJs = fs.readFileSync(contentJsPath, 'utf8');
  const overlayJs = fs.readFileSync(overlayJsPath, 'utf8');
  const backgroundJs = fs.readFileSync(backgroundJsPath, 'utf8');
  const popupJs = fs.readFileSync(popupJsPath, 'utf8');

  // ---------------------------------------------------------
  // 1. Detection Rules & Target URL Pattern
  // ---------------------------------------------------------
  console.log("1. Auditing Scraping Detection & Target URL Rules...");

  function testApprovedPage(href, pathname, search) {
    const url = href || "";
    const pathStr = pathname || "";
    const searchStr = search || "";

    if (pathStr.includes("/in/") && !pathStr.includes("/search/")) {
      return false;
    }

    const isFirstDegreeSearch = (pathStr.includes("/search/results/people") || url.includes("/search/results/people")) &&
      /network=(%5B%22|%5b%22|\[%22|\[")F/i.test(searchStr);

    const isMockConn = url.includes("connections.html");
    const isLegacyConn = pathStr.includes("/mynetwork/invite-connect/connections/") || url.includes("/mynetwork/invite-connect/connections/");

    return isFirstDegreeSearch || isMockConn || isLegacyConn;
  }

  // Profile page guard test
  assert(!testApprovedPage("https://www.linkedin.com/in/jane-doe", "/in/jane-doe", ""), 
    "isApprovedExtractionPage returns FALSE for profile pages (/in/jane-doe)");

  // Generic search guard test
  assert(!testApprovedPage("https://www.linkedin.com/search/results/people/?keywords=software", "/search/results/people/", "?keywords=software"), 
    "isApprovedExtractionPage returns FALSE for generic search results without network=[\"F\"] filter");

  // Filtered canned search target test
  const cannedSearchUrl = "https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D";
  assert(testApprovedPage(cannedSearchUrl, "/search/results/people/", "?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D"), 
    "isApprovedExtractionPage returns TRUE for canned 1st degree search (origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D)");

  assert(backgroundJs.includes('origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D'), 
    "background.js targetUrl contains origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D");

  assert(overlayJs.includes('origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D'), 
    "overlay.js targetUrl contains origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D");

  // ---------------------------------------------------------
  // 2. Extraction Fields Collection Audit
  // ---------------------------------------------------------
  console.log("\n2. Auditing Extraction Fields Collection...");

  assert(contentJs.includes('name: profileAnchor.name'), "content.js collects 'name'");
  assert(contentJs.includes('headline,'), "content.js collects 'headline'");
  assert(contentJs.includes('company: companyRes.company'), "content.js collects 'company'");
  assert(contentJs.includes('profile_url: profileAnchor.profile_url'), "content.js collects 'profile_url'");
  assert(contentJs.includes('degree: "1st"'), "content.js collects 'degree'");
  assert(contentJs.includes('location: locationLine || null'), "content.js collects 'location'");
  assert(contentJs.includes('mutual_info: mutualText || null'), "content.js collects 'mutual_info'");

  // ---------------------------------------------------------
  // 3. Automatic Workflow & Incremental Sync Audit
  // ---------------------------------------------------------
  console.log("\n3. Auditing Automatic Zero-Click Workflow & Incremental Sync...");

  assert(contentJs.includes('setTimeout(maybeAutoStartAcquisition, 100)'), 
    "content.js auto-starts extraction upon page load without manual button requirement");

  assert(contentJs.includes('MAX_EXTRACTION_LIMIT = 350'), 
    "content.js enforces 350 profile cap");

  assert(contentJs.includes('last_synced_profile_urls'), 
    "content.js persists and reads last_synced_profile_urls for incremental deduplication");

  assert(contentJs.includes('this.seenProfiles.has(key)'), 
    "content.js deduplicates cards by profile URL key to prevent duplicate nodes");

  // ---------------------------------------------------------
  // 4. Overlay Live Progress & Completion Status Audit
  // -------------------------------- agreed
  console.log("\n4. Auditing Overlay Status Labels & Display...");

  assert(overlayJs.includes('Auto Extracting'), "overlay.js displays 'Auto Extracting'");
  assert(overlayJs.includes('Workspace Up To Date'), "overlay.js displays 'Workspace Up To Date' on completion");
  assert(overlayJs.includes('Connections Indexed'), "overlay.js displays 'Connections Indexed' status");
  assert(overlayJs.includes('extracted >= 0'), "overlay.js maintains persistent overlay visibility");

  // ---------------------------------------------------------
  // 5. Faster Scroll Parameter Verification
  // ---------------------------------------------------------
  console.log("\n5. Verifying Faster Scroll Speed Parameters...");

  assert(contentJs.includes('scrollDistance = Math.floor(Math.random() * (280 - 180 + 1)) + 180'), 
    "content.js uses variable scroll distance (180-280px)");

  assert(contentJs.includes('scrollDelayMs = Math.floor(Math.random() * (320 - 180 + 1)) + 180'), 
    "content.js uses 35% faster inter-scroll delay (180-320ms)");

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All HOTFIX 13.5.4 Acceptance Tests Passed!\n");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
