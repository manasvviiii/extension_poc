/**
 * Acceptance Test Suite for TASK 13.5.3 — Invisible Local Workspace (Zero-Click UX)
 */

const fs = require('fs');
const path = require('path');
const { AuthService } = require('../extension/auth.js');

console.log("=================================================");
console.log("RUNNING TASK 13.5.3 ACCEPTANCE TEST SUITE");
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
  // 1. Audit popup.html for complete removal of all auth UI elements
  console.log("1. Auditing extension/popup.html for ZERO Auth UI elements...");
  const popupHtmlPath = path.join(__dirname, '..', 'extension', 'popup.html');
  const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

  assert(!popupHtml.includes('id="authScreen"'), "authScreen container completely removed from popup.html");
  assert(!popupHtml.includes('id="btnContinueLocally"'), "btnContinueLocally button completely removed from popup.html");
  assert(!popupHtml.includes('id="btnLogout"'), "btnLogout button completely removed from popup.html");
  assert(!popupHtml.includes('type="password"'), "Zero password inputs in popup.html");
  assert(!popupHtml.includes('id="authUserNameInput"'), "Zero username inputs in popup.html");
  assert(!popupHtml.includes('id="authUserEmailInput"'), "Zero email inputs in popup.html");

  assert(popupHtml.includes('id="workspaceIdText"'), "popup.html header displays workspaceIdText element");
  assert(popupHtml.includes('id="workspaceLastSyncText"'), "popup.html header displays workspaceLastSyncText element");
  assert(popupHtml.includes('Workspace ID:'), "popup.html header contains 'Workspace ID:' text");

  // 2. Test Automatic Workspace Provisioning (Zero-Click UX)
  console.log("\n2. Testing Automatic Workspace Provisioning (Zero-Click UX)...");
  await AuthService.logout(); // Clear storage to simulate fresh first launch

  // First call to getCurrentUser on fresh launch automatically provisions local workspace!
  const user = await AuthService.getCurrentUser();

  assert(user !== null && typeof user === "object", "getCurrentUser() automatically provisions local user object");
  assert(user.id && user.id.startsWith("wg_"), `Generated workspace ID starts with 'wg_' (got: ${user.id})`);
  assert(user.name === "WarmGraph User", "User name is 'WarmGraph User'");
  assert(user.provider === "local", "User provider is 'local'");
  assert(user.created_at !== undefined, "User created_at timestamp present");
  assert(user.last_active !== undefined, "User last_active timestamp present");

  const token = await AuthService.getAccessToken();
  const rawUuid = user.id.replace(/^wg_/, '');
  assert(token === `wg_local_${rawUuid}`, `Access token is 'wg_local_${rawUuid}' (got: ${token})`);

  const isAuth = await AuthService.isAuthenticated();
  assert(isAuth === true, "isAuthenticated() is always true");

  // Subsequent call retrieves the exact same persistent UUID
  const resumedUser = await AuthService.getCurrentUser();
  assert(resumedUser.id === user.id, "Subsequent calls retain the exact same persistent workspace UUID");

  // 3. Audit popup.js & overlay.js for zero login UI references
  console.log("\n3. Auditing popup.js & overlay.js for zero login UI code...");
  const popupJsPath = path.join(__dirname, '..', 'extension', 'popup.js');
  const overlayJsPath = path.join(__dirname, '..', 'extension', 'overlay.js');

  const popupJs = fs.readFileSync(popupJsPath, 'utf8');
  const overlayJs = fs.readFileSync(overlayJsPath, 'utf8');

  assert(!popupJs.includes('initAuthScreen'), "popup.js contains no legacy initAuthScreen");
  assert(!popupJs.includes('btnContinueLocally'), "popup.js contains no btnContinueLocally handler");
  assert(!popupJs.includes('btnLogout'), "popup.js contains no btnLogout handler");
  assert(popupJs.includes('initWorkspaceHeader'), "popup.js contains initWorkspaceHeader for workspace ID header display");

  assert(overlayJs.includes('Auto Extracting'), "overlay.js displays 'Auto Extracting' status");
  assert(!overlayJs.includes('loginLocal'), "overlay.js contains zero login triggers");

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All Task 13.5.3 Acceptance Tests Passed!\n");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
