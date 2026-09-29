/**
 * Acceptance Test Suite for TASK 13.5.1 — Replace Login with Local Workspace ID
 */

const fs = require('fs');
const path = require('path');
const { AuthService } = require('../extension/auth.js');

console.log("=================================================");
console.log("RUNNING TASK 13.5.1 ACCEPTANCE TEST SUITE");
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
  // 1. Verify zero username / password / email fields in popup.html
  console.log("1. Auditing Popup HTML for zero credential fields...");
  const popupHtmlPath = path.join(__dirname, '..', 'extension', 'popup.html');
  const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');

  assert(!popupHtml.includes('type="password"'), "No password input in popup.html");
  assert(!popupHtml.includes('id="authUserNameInput"'), "No username input in popup.html");
  assert(!popupHtml.includes('id="authUserEmailInput"'), "No email input in popup.html");
  assert(popupHtml.includes('Welcome to WarmGraph'), "Contains 'Welcome to WarmGraph' title");
  assert(popupHtml.includes("We'll create a secure local workspace"), "Contains onboarding subtitle");
  assert(popupHtml.includes('Continue Locally'), "Contains 'Continue Locally' CTA");

  // 2. Test AuthService Methods & Local Identity Generation
  console.log("\n2. Testing Local Identity Generation & Persistence...");
  await AuthService.logout();

  const isAuthInitial = await AuthService.isAuthenticated();
  assert(!isAuthInitial, "isAuthenticated() is false before login");

  // First launch login
  const user1 = await AuthService.loginLocal();
  assert(user1 && typeof user1.id === "string", "User object returned");
  assert(user1.id.startsWith("wg_"), `User ID starts with 'wg_' (got: ${user1.id})`);
  assert(user1.name === "WarmGraph User", "User name is 'WarmGraph User'");
  assert(user1.provider === "local", "User provider is 'local'");
  assert(user1.created_at !== undefined, "User created_at timestamp present");
  assert(user1.last_active !== undefined, "User last_active timestamp present");
  assert(user1.email === undefined, "No email field in user object");
  assert(user1.password === undefined, "No password field in user object");

  // Check access token format
  const token1 = await AuthService.getAccessToken();
  const rawUuid1 = user1.id.replace(/^wg_/, '');
  assert(token1 === `wg_local_${rawUuid1}`, `getAccessToken() returns 'wg_local_${rawUuid1}' (got: ${token1})`);

  const isAuthPost = await AuthService.isAuthenticated();
  assert(isAuthPost, "isAuthenticated() is true after loginLocal()");

  // Re-reading identity (simulating reopening popup)
  const currentUser = await AuthService.getCurrentUser();
  assert(currentUser.id === user1.id, "Reopening extension retains the same persistent UUID");

  // Calling loginLocal() again without clearing storage retains the same UUID
  const user1Resumed = await AuthService.loginLocal();
  assert(user1Resumed.id === user1.id, "Calling loginLocal() on existing user keeps the same UUID");

  // 3. Test Logout & Storage Clearing
  console.log("\n3. Testing Workspace Preserving Logout...");
  await AuthService.logout();
  const isAuthLoggedOut = await AuthService.isAuthenticated();
  assert(!isAuthLoggedOut, "isAuthenticated() is false after logout()");

  // Logging in after clearing storage generates a NEW UUID
  const user2 = await AuthService.loginLocal();
  assert(user2.id.startsWith("wg_"), "New login after storage clear generates valid wg_ UUID");
  assert(user2.id !== user1.id, `New UUID generated after storage clear (old: ${user1.id}, new: ${user2.id})`);

  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: All Task 13.5.1 JS Acceptance Tests Passed!\n");
  }
}

runTests().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
