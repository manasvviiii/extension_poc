const fs = require('fs');
const path = require('path');

console.log("=================================================");
console.log("RUNNING TASK 10.0 MY NETWORK WORKSPACE TESTS");
console.log("=================================================");

const rootDir = path.resolve(__dirname, '..');
const networkHtmlPath = path.join(rootDir, 'website', 'network.html');
const networkCssPath = path.join(rootDir, 'website', 'css', 'network.css');
const networkJsPath = path.join(rootDir, 'website', 'js', 'network.js');

let errors = [];

// [TEST 1] File Existence
console.log("\n[TEST 1] Checking file existence...");
if (fs.existsSync(networkHtmlPath)) {
  console.log("✓ website/network.html exists");
} else {
  errors.push("Missing website/network.html");
}

if (fs.existsSync(networkCssPath)) {
  console.log("✓ website/css/network.css exists");
} else {
  errors.push("Missing website/css/network.css");
}

if (fs.existsSync(networkJsPath)) {
  console.log("✓ website/js/network.js exists");
} else {
  errors.push("Missing website/js/network.js");
}

// [TEST 2] Validate network.html Structure & Elements
console.log("\n[TEST 2] Validating network.html elements & IDs...");
const htmlContent = fs.readFileSync(networkHtmlPath, 'utf8');

const requiredElements = [
  'hero-connection-count',
  'hero-last-synced',
  'network-search-input',
  'filter-pills',
  'connection-grid',
  'empty-state',
  'clear-search-btn',
  'profile-drawer',
  'drawer-backdrop',
  'close-drawer-btn',
  'drawer-avatar',
  'drawer-name',
  'drawer-headline',
  'drawer-company',
  'drawer-evidence-list',
  'drawer-mutual-chips',
  'drawer-warm-intro-btn'
];

requiredElements.forEach(id => {
  if (htmlContent.includes(`id="${id}"`)) {
    console.log(`✓ Required element #${id} present in HTML`);
  } else {
    errors.push(`Missing element #${id} in network.html`);
  }
});

// [TEST 3] Validate Filter Pills Category Data Attributes
console.log("\n[TEST 3] Checking filter pills category attributes...");
const categories = ['all', 'students', 'faculty', 'company', '1st'];
categories.forEach(cat => {
  if (htmlContent.includes(`data-filter="${cat}"`)) {
    console.log(`✓ Filter pill data-filter="${cat}" verified`);
  } else {
    errors.push(`Missing filter pill data-filter="${cat}"`);
  }
});

// [TEST 4] Validate network.js logic & generateMockConnections
console.log("\n[TEST 4] Testing network.js data engine...");
const jsContent = fs.readFileSync(networkJsPath, 'utf8');

if (jsContent.includes('loadNetworkFromStorage') || jsContent.includes('warmgraph_active_graph')) {
  console.log("✓ Dynamic network loader present");
} else {
  errors.push("Dynamic network loader missing or incomplete");
}

if (jsContent.includes('applyFiltersAndRender') && jsContent.includes('openDrawer')) {
  console.log("✓ Search/filter engine and side drawer functions present");
} else {
  errors.push("Search/filter engine or openDrawer missing");
}

if (jsContent.includes('setupKeyboardShortcuts') && (jsContent.includes('cmdKey') || jsContent.includes('metaKey'))) {
  console.log("✓ CMD+K keyboard shortcut handler present");
} else {
  errors.push("CMD+K shortcut handler missing");
}

// Summary
console.log("\n=================================================");
if (errors.length === 0) {
  console.log("ALL TASK 10.0 ACCEPTANCE TESTS PASSED SUCCESSFULLY! ✓");
} else {
  console.error("TEST FAILURES:");
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}
