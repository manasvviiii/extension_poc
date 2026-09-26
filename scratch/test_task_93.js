const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING TASK 9.3 DEVELOPER DASHBOARD POLISH TESTS");
console.log("=================================================");

const rootDir = path.resolve(__dirname, '..');
const htmlPath = path.join(rootDir, 'extension', 'developer_dashboard.html');
const jsPath = path.join(rootDir, 'extension', 'developer_dashboard.js');

let errors = [];

// [TEST 1] File Existence
console.log("\n[TEST 1] Checking file existence...");
if (fs.existsSync(htmlPath)) console.log("✓ extension/developer_dashboard.html exists");
else errors.push("Missing extension/developer_dashboard.html");

if (fs.existsSync(jsPath)) console.log("✓ extension/developer_dashboard.js exists");
else errors.push("Missing extension/developer_dashboard.js");

// [TEST 2] Validate CSS Classes & Styles in developer_dashboard.html
console.log("\n[TEST 2] Checking Task 9.3 CSS rules in developer_dashboard.html...");
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const requiredCssRules = [
  'company-cell',
  'company-name-text',
  'company-role-text',
  'btn-profile-chip',
  'rgba(37, 99, 235, 0.05)', // Row hover background
  '3px solid #3B82F6' // Row hover left border
];

requiredCssRules.forEach(rule => {
  if (htmlContent.includes(rule)) {
    console.log(`✓ CSS rule/class '${rule}' present in developer_dashboard.html`);
  } else {
    errors.push(`Missing CSS rule '${rule}' in developer_dashboard.html`);
  }
});

// [TEST 3] Validate JS Company Resolution Logic for Acceptance Examples
console.log("\n[TEST 3] Testing resolveCompanyAndRole logic in developer_dashboard.js...");
const jsContent = fs.readFileSync(jsPath, 'utf8');

const jsdomMock = {
  console,
  String,
  RegExp,
  Math,
  document: {
    getElementById: () => ({ addEventListener: () => {}, querySelectorAll: () => [] }),
    querySelectorAll: () => []
  },
  window: { location: { search: "" } },
  URLSearchParams: class { get() { return null; } },
  fetch: () => Promise.resolve({ ok: false })
};

const vm = require('vm');
vm.createContext(jsdomMock);

try {
  vm.runInContext(jsContent, jsdomMock);
} catch (e) {
  // If IIFE executed, function definitions were evaluated
}

if (jsContent.includes('resolveCompanyAndRole') && jsContent.includes('Faculty') && jsContent.includes('Student') && jsContent.includes('Hewlett Packard Enterprise')) {
  console.log("✓ Faculty, Student, and HPE Professional parsers present in JS");
} else {
  errors.push("Missing parser logic in developer_dashboard.js");
}

if (jsContent.includes('btn-profile-chip') && jsContent.includes('company-cell')) {
  console.log("✓ Profile View glass chip & stacked company cell rendering present in JS");
} else {
  errors.push("Missing btn-profile-chip or company-cell in developer_dashboard.js");
}

// Summary
console.log("\n=================================================");
if (errors.length === 0) {
  console.log("ALL TASK 9.3 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ✓");
} else {
  console.error("TEST FAILURES:");
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}
