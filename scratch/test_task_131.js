/**
 * Task 13.1 — Acceptance Verification Script
 * Local Authentication Abstraction (Cloud Ready)
 */

const fs = require('fs');
const path = require('path');
const { AuthService } = require('../extension/auth.js');

console.log("=========================================");
console.log("RUNNING TASK 13.1 ACCEPTANCE TEST SUITE");
console.log("=========================================\n");

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

// 1. Audit AuthService Methods
console.log("1. Testing AuthService Abstract API Methods...");
assert(typeof AuthService.getCurrentUser === "function", "AuthService.getCurrentUser() exists");
assert(typeof AuthService.loginLocal === "function", "AuthService.loginLocal() exists");
assert(typeof AuthService.logout === "function", "AuthService.logout() exists");
assert(typeof AuthService.isAuthenticated === "function", "AuthService.isAuthenticated() exists");
assert(typeof AuthService.getAccessToken === "function", "AuthService.getAccessToken() exists");

// 2. Test Login & Session Model Schema
async function runAuthUnitTests() {
  console.log("\n2. Testing Local Session Persistence & Schema...");
  
  // Initial state — unauthenticated
  await AuthService.logout();
  const isAuthInitial = await AuthService.isAuthenticated();
  assert(!isAuthInitial, "isAuthenticated() returns false when no session exists");
  
  // Login locally
  const user = await AuthService.loginLocal({
    name: "WarmGraph User",
    email: "local@warmgraph.dev"
  });
  
  assert(user && user.id === "local_user", "User model contains id: 'local_user'");
  assert(user.email === "local@warmgraph.dev", "User model contains email: 'local@warmgraph.dev'");
  assert(user.provider === "local", "User model contains provider: 'local'");
  
  const token = await AuthService.getAccessToken();
  assert(typeof token === "string" && token.length > 5, "getAccessToken() returns token string");
  
  const isAuthPost = await AuthService.isAuthenticated();
  assert(isAuthPost, "isAuthenticated() returns true after loginLocal()");
  
  // Logout
  await AuthService.logout();
  const isAuthLoggedOut = await AuthService.isAuthenticated();
  assert(!isAuthLoggedOut, "isAuthenticated() returns false after logout()");
}

// 3. Audit Popup HTML & JS for Auth UI
console.log("\n3. Auditing Popup HTML & JS for Auth Elements...");
const popupHtmlPath = path.join(__dirname, '..', 'extension', 'popup.html');
const popupJsPath = path.join(__dirname, '..', 'extension', 'popup.js');

const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');
const popupJs = fs.readFileSync(popupJsPath, 'utf8');

assert(popupHtml.includes('id="authScreen"'), "popup.html contains #authScreen container");
assert(popupHtml.includes('id="btnContinueLocally"'), "popup.html contains #btnContinueLocally CTA button");
assert(popupHtml.includes('auth.js'), "popup.html links auth.js script tag");

assert(popupJs.includes('initAuthScreen'), "popup.js includes initAuthScreen handler");
assert(popupJs.includes('AuthService.loginLocal'), "popup.js invokes AuthService.loginLocal");
assert(popupJs.includes('AuthService.logout'), "popup.js invokes AuthService.logout");

// 4. Audit Backend Dependencies & Routes
console.log("\n4. Auditing Backend Auth Dependency & Endpoint...");
const depsPath = path.join(__dirname, '..', 'backend', 'auth', 'dependencies.py');
const mainPyPath = path.join(__dirname, '..', 'backend', 'main.py');

const depsPy = fs.readFileSync(depsPath, 'utf8');
const mainPy = fs.readFileSync(mainPyPath, 'utf8');

assert(depsPy.includes('def get_current_user'), "backend/auth/dependencies.py contains get_current_user dependency");
assert(depsPy.includes('class LocalUser'), "backend/auth/dependencies.py contains LocalUser model");
assert(mainPy.includes('/auth/me'), "backend/main.py contains /auth/me route");

runAuthUnitTests().then(() => {
  console.log("\n-----------------------------------------");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("-----------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("SUCCESS: Task 13.1 Acceptance Criteria Met!\n");
    process.exit(0);
  }
});
